document.addEventListener("DOMContentLoaded", () => {
    // 確保 Firebase SDK 已經準備好
    setTimeout(() => {
        if (!window.firebaseAuth || !window.onAuthStateChanged) {
            Swal.fire('系統錯誤', 'Firebase SDK 載入失敗', 'error');
            return;
        }

        // 監聽登入狀態
        window.onAuthStateChanged(window.firebaseAuth, async (user) => {
            if (user) {
                // 已登入，讀取使用者資料
                await loadUserProfile(user);
            } else {
                // 未登入，強制導回登入頁
                window.location.href = 'index.html';
            }
        });
    }, 500);
});

async function loadUserProfile(user) {
    try {
        // 從 Firestore 讀取用戶權限與基本資料
        const userRef = window.fs.doc(window.firebaseDb, 'users', user.uid);
        const userSnap = await window.fs.getDoc(userRef);

        if (userSnap.exists()) {
            const userData = userSnap.data();
            const role = userData.role || 'GUEST';
            
            // 設定頂部頭像與名稱 (優先使用資料庫中的 LINE 資料)
            document.getElementById('navUserName').textContent = userData.name || user.displayName || '使用者';
            document.getElementById('navUserPic').src = userData.picture || user.photoURL || 'https://via.placeholder.com/40';
            
            applyRoleUI(role);
        } else {
            // 資料庫中沒有資料 (異常狀態)
            document.getElementById('navUserName').textContent = user.displayName || '未知使用者';
            applyRoleUI('GUEST');
        }

        // 隱藏 Loader，顯示內容
        document.getElementById('dashboardLoader').style.display = 'none';

    } catch (error) {
        console.error("載入權限失敗:", error);
        Swal.fire('錯誤', '無法載入您的權限資料', 'error');
    }
}

function applyRoleUI(role) {
    const roleNameEl = document.getElementById('navUserRole');
    const displayRoleNameEl = document.getElementById('displayRoleName');
    const contentEl = document.getElementById('dashboardContent');
    const noAccessEl = document.getElementById('noAccessContent');

    // 隱藏所有特定權限區塊
    document.querySelectorAll('.role-super-admin, .role-org-admin').forEach(el => {
        el.style.display = 'none';
    });

    // ==========================================
    // 超級管理員專用功能：機構與人員管理
    // ==========================================
    let allUsers = [];

    async function loadOrgsAndUsers() {
        try {
            const { collection, getDocs } = window.fs;
            const db = window.firebaseDb;

            // 1. 載入所有使用者名單
            const usersSnap = await getDocs(collection(db, 'users'));
            allUsers = [];
            const adminSelect = document.getElementById('orgAdminSelect');
            adminSelect.innerHTML = '<option value="">請選擇一位管理員...</option>';

            usersSnap.forEach(doc => {
                const u = doc.data();
                u.uid = doc.id;
                allUsers.push(u);

                // 只有 GUEST (尚未綁定機構) 的人才能被選為新機構管理員
                if (!u.role || u.role === 'GUEST') {
                    const opt = document.createElement('option');
                    opt.value = u.uid;
                    opt.textContent = `${u.name} (無所屬機構)`;
                    adminSelect.appendChild(opt);
                }
            });

            // 2. 載入所有機構列表
            const orgsSnap = await getDocs(collection(db, 'organizations'));
            const tbody = document.getElementById('orgTableBody');
            tbody.innerHTML = '';

            if (orgsSnap.empty) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">尚無任何機構，請點擊上方按鈕建立</td></tr>';
                return;
            }

            orgsSnap.forEach(doc => {
                const org = doc.data();
                const orgId = doc.id;
                
                // 找出管理員名字
                const adminUser = allUsers.find(u => u.uid === org.admin_uid);
                const adminName = adminUser ? adminUser.name : '<span class="text-danger">未指派/找不到</span>';
                const sealStatus = org.seal_url ? '<span class="badge bg-success">已上傳</span>' : '<span class="badge bg-warning text-dark">未上傳</span>';
                const createDate = org.createdAt ? new Date(org.createdAt.toDate()).toLocaleDateString() : '未知';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="fw-bold">${org.name}</td>
                    <td>${adminName}</td>
                    <td>${sealStatus}</td>
                    <td>${createDate}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteOrg('${orgId}', '${org.name}')">刪除</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

        } catch (error) {
            console.error("載入機構資料失敗:", error);
            Swal.fire('錯誤', '無法載入機構列表', 'error');
        }
    }

    // 建立新機構
    document.getElementById('saveOrgBtn')?.addEventListener('click', async () => {
        const orgName = document.getElementById('orgNameInput').value.trim();
        const adminUid = document.getElementById('orgAdminSelect').value;

        if (!orgName || !adminUid) {
            Swal.fire('提示', '請填寫機構名稱並選擇管理員', 'warning');
            return;
        }

        try {
            const { collection, addDoc, doc, updateDoc, serverTimestamp } = window.fs;
            const db = window.firebaseDb;
            const saveBtn = document.getElementById('saveOrgBtn');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 建立中...';

            // 1. 建立機構文件
            const newOrgRef = await addDoc(collection(db, 'organizations'), {
                name: orgName,
                admin_uid: adminUid,
                seal_url: null,
                createdAt: serverTimestamp()
            });

            // 2. 更新被指派者的權限 (role: ORG_ADMIN, org_id: newOrgRef.id)
            await updateDoc(doc(db, 'users', adminUid), {
                role: 'ORG_ADMIN',
                org_id: newOrgRef.id
            });

            Swal.fire('成功', '已成功建立機構並指派管理員！', 'success');
            
            // 關閉 Modal 並重新載入列表
            const modalEl = document.getElementById('createOrgModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
            document.getElementById('createOrgForm').reset();
            
            loadOrgsAndUsers();

        } catch (error) {
            console.error("建立機構失敗:", error);
            Swal.fire('錯誤', '建立機構失敗: ' + error.message, 'error');
        } finally {
            const saveBtn = document.getElementById('saveOrgBtn');
            saveBtn.disabled = false;
            saveBtn.textContent = '建立機構';
        }
    });

    // 刪除機構 (呼叫後端 API 以確保連鎖刪除)
    window.deleteOrg = function(orgId, orgName) {
        Swal.fire({
            title: '確定要刪除此機構嗎？',
            html: `您即將刪除 <b>${orgName}</b>。<br><br><span class="text-danger fw-bold">⚠️ 警告：此操作將會連鎖刪除該機構底下的「所有選舉場次」，且無法復原！</span>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: '是的，我確定要徹底刪除',
            cancelButtonText: '取消'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    // 取得目前的 IdToken
                    const idToken = await window.firebaseAuth.currentUser.getIdToken();
                    
                    // 呼叫我們自己寫的後端 API
                    const response = await fetch(`/api/admin/organizations/${orgId}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${idToken}`
                        }
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        Swal.fire('已刪除', '機構與相關資料已成功刪除', 'success');
                        loadOrgsAndUsers();
                    } else {
                        throw new Error(data.message || '伺服器拒絕刪除');
                    }
                } catch (error) {
                    console.error("刪除失敗:", error);
                    Swal.fire('刪除失敗', error.message, 'error');
                }
            }
        });
    };

    if (role === 'SUPER_ADMIN') {
        roleNameEl.textContent = '系統超級管理員';
        roleNameEl.className = 'badge bg-danger';
        displayRoleNameEl.textContent = '系統超級管理員';
        
        // 顯示超級管理員區塊
        document.querySelectorAll('.role-super-admin').forEach(el => {
            el.style.display = 'block';
        });
        contentEl.style.display = 'block';

        // 載入系統資料 (機構列表與候補管理員名單)
        loadOrgsAndUsers();

    } else if (role === 'ORG_ADMIN') {
        roleNameEl.textContent = '單位管理員';
        roleNameEl.className = 'badge bg-primary';
        displayRoleNameEl.textContent = '單位管理員';
        
        // 顯示單位管理員區塊
        document.querySelectorAll('.role-org-admin').forEach(el => {
            el.style.display = 'block';
        });
        contentEl.style.display = 'block';

    } else {
        // GUEST 或未知權限
        roleNameEl.textContent = '未授權帳號';
        roleNameEl.className = 'badge bg-secondary';
        
        // 顯示無權限提示
        noAccessEl.style.display = 'block';
    }
}

function handleLogout() {
    Swal.fire({
        title: '確定要登出嗎？',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: '是的，登出',
        cancelButtonText: '取消'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await window.signOut(window.firebaseAuth);
                // 登出成功後，onAuthStateChanged 會自動導回 index.html
            } catch (error) {
                console.error('登出失敗:', error);
                Swal.fire('錯誤', '登出失敗，請稍後再試', 'error');
            }
        }
    });
}
