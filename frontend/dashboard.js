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
            
            // 取得 Custom Token 裡的 org_ids
            const tokenResult = await user.getIdTokenResult();
            const org_ids = tokenResult.claims.org_ids || userData.org_ids || [];
            
            // 設定頂部頭像與名稱 (優先使用資料庫中的 LINE 資料)
            document.getElementById('navUserName').textContent = userData.name || user.displayName || '使用者';
            document.getElementById('navUserPic').src = userData.picture || user.photoURL || 'https://via.placeholder.com/40';
            
            applyRoleUI(role, org_ids);
        } else {
            // 資料庫中沒有資料 (異常狀態)
            document.getElementById('navUserName').textContent = user.displayName || '未知使用者';
            applyRoleUI('GUEST', []);
        }

        // 隱藏 Loader，顯示內容
        document.getElementById('dashboardLoader').style.display = 'none';

    } catch (error) {
        console.error("載入權限失敗:", error);
        Swal.fire('錯誤', '無法載入您的權限資料', 'error');
    }
}

function applyRoleUI(role, org_ids) {
    const roleNameEl = document.getElementById('navUserRole');
    const displayRoleNameEl = document.getElementById('displayRoleName');
    const contentEl = document.getElementById('dashboardContent');
    const noAccessEl = document.getElementById('noAccessContent');

    // 隱藏所有特定權限區塊
    document.querySelectorAll('.role-super-admin, .role-org-admin').forEach(el => {
        el.style.display = 'none';
    });

    // ==========================================
    // 舊版函數已移除
    // ==========================================

    // 建立新機構
    document.getElementById('saveOrgBtn')?.addEventListener('click', async () => {
        const orgName = document.getElementById('orgNameInput').value.trim();
        const adminUid = document.getElementById('orgAdminSelect').value;

        if (!orgName || !adminUid) {
            Swal.fire('提示', '請填寫機構名稱並選擇管理員', 'warning');
            return;
        }

        try {
            const { collection, addDoc, serverTimestamp } = window.fs;
            const db = window.firebaseDb;
            const saveBtn = document.getElementById('saveOrgBtn');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 建立中...';

            await addDoc(collection(db, 'organizations'), {
                name: orgName,
                seal_url: null,
                createdAt: serverTimestamp()
            });

            Swal.fire('成功', '已成功建立機構！', 'success');
            
            const modalEl = document.getElementById('createOrgModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
            document.getElementById('createOrgForm').reset();
            
            // 重新載入全域資料
            await loadOrgSwitcher();
            loadAdminDashboard();

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
                        await loadOrgSwitcher();
                        loadAdminDashboard();
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

    // 開啟授權 Modal
    window.openAssignModal = function(uid, name) {
        const targetUser = allUsers.find(u => u.uid === uid);
        if (!targetUser) return;

        document.getElementById('assignTargetName').textContent = name;
        document.getElementById('assignTargetUid').value = uid;

        const container = document.getElementById('orgCheckboxesContainer');
        container.innerHTML = '';

        if (allOrgs.length === 0) {
            container.innerHTML = '<p class="text-muted">尚無任何機構可供授權</p>';
        } else {
            const userOrgIds = targetUser.org_ids || [];
            allOrgs.forEach(org => {
                const isChecked = userOrgIds.includes(org.id) ? 'checked' : '';
                container.innerHTML += `
                    <div class="form-check mb-2">
                        <input class="form-check-input org-checkbox" type="checkbox" value="${org.id}" id="chk_${org.id}" ${isChecked}>
                        <label class="form-check-label" for="chk_${org.id}">
                            ${org.name}
                        </label>
                    </div>
                `;
            });
        }

        const modal = new bootstrap.Modal(document.getElementById('assignAdminModal'));
        modal.show();
    };

    // 儲存授權變更
    document.getElementById('saveAssignBtn')?.addEventListener('click', async () => {
        const uid = document.getElementById('assignTargetUid').value;
        if (!uid) return;

        const checkboxes = document.querySelectorAll('.org-checkbox:checked');
        const selectedOrgIds = Array.from(checkboxes).map(cb => cb.value);

        try {
            const { doc, updateDoc } = window.fs;
            const db = window.firebaseDb;
            const btn = document.getElementById('saveAssignBtn');
            btn.disabled = true;
            btn.textContent = '儲存中...';

            const newRole = selectedOrgIds.length > 0 ? 'ORG_ADMIN' : 'GUEST';

            await updateDoc(doc(db, 'users', uid), {
                role: newRole,
                org_ids: selectedOrgIds
            });

            Swal.fire('成功', '權限設定已儲存！', 'success');
            bootstrap.Modal.getInstance(document.getElementById('assignAdminModal')).hide();
            
            // 重新載入列表
            loadAdminDashboard();

        } catch (error) {
            console.error("儲存授權失敗:", error);
            Swal.fire('錯誤', error.message, 'error');
        } finally {
            const btn = document.getElementById('saveAssignBtn');
            btn.disabled = false;
            btn.textContent = '儲存授權';
        }
    });

    // ==========================================
    // 依據角色啟動對應功能
    // ==========================================
    if (role === 'SUPER_ADMIN') {
        roleNameEl.textContent = '系統超級管理員';
        roleNameEl.className = 'badge bg-danger';
        displayRoleNameEl.textContent = '系統超級管理員';
        
        document.querySelectorAll('.role-super-admin').forEach(el => el.style.display = 'block');
        contentEl.style.display = 'block';

        loadOrgSwitcher().then(() => loadAdminDashboard());

    } else if (role === 'ORG_ADMIN') {
        roleNameEl.textContent = '單位管理員';
        roleNameEl.className = 'badge bg-primary';
        displayRoleNameEl.textContent = '單位管理員';
        
        document.querySelectorAll('.role-org-admin').forEach(el => el.style.display = 'block');
        contentEl.style.display = 'block';

        loadOrgSwitcher();

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
