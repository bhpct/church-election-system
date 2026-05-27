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
                currentUserId = user.uid;
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
            
            // 取得 Custom Token 裡的 org_roles (強制更新以確保讀取到最新權限)
            const tokenResult = await user.getIdTokenResult(true);
            const org_roles = tokenResult.claims.org_roles || userData.org_roles || {};
            
            // 設定頂部頭像與名稱 (優先使用資料庫中的 LINE 資料)
            document.getElementById('navUserName').textContent = userData.name || user.displayName || '使用者';
            document.getElementById('navUserPic').src = userData.picture || user.photoURL || 'assets/logo.png';
            
            applyRoleUI(role, org_roles);
        } else {
            // 資料庫中沒有資料 (異常狀態)
            document.getElementById('navUserName').textContent = user.displayName || '未知使用者';
            applyRoleUI('GUEST', {});
        }

        // 隱藏 Loader，顯示內容
        document.getElementById('dashboardLoader').style.display = 'none';

    } catch (error) {
        console.error("載入權限失敗:", error);
        Swal.fire('錯誤', '無法載入您的權限資料: ' + error.message + '\n' + error.stack, 'error');
    }
}

// 全域變數
const API_BASE_URL = "https://church-election-system-1089220354332.asia-east1.run.app/api";
let allOrgs = [];
let allUsers = [];
let currentUserRole = 'GUEST';
let currentUserId = null;

// ==========================================
// 載入機構視角切換器
// ==========================================
async function loadOrgSwitcher(role, org_roles) {
    const { collection, getDocs } = window.fs;
    const db = window.firebaseDb;
    const switcherContainer = document.getElementById('orgSwitcherContainer');
    const selectEl = document.getElementById('currentOrgSelect');
    
    try {
        allOrgs = [];
        if (role === 'SUPER_ADMIN') {
            // 超級管理員：載入所有機構
            const snap = await getDocs(collection(db, 'organizations'));
            snap.forEach(doc => allOrgs.push({ id: doc.id, ...doc.data() }));
        } else if (role === 'ORG_ADMIN' || Object.keys(org_roles).length > 0) {
            // 單位管理員：列出所有已被授權的機構
            const org_ids = Object.keys(org_roles);
            const { doc, getDoc } = window.fs;
            const promises = org_ids.map(id => getDoc(doc(db, 'organizations', id)));
            const snaps = await Promise.all(promises);
            snaps.forEach(snap => {
                if (snap.exists()) {
                    allOrgs.push({ id: snap.id, ...snap.data(), local_role: org_roles[snap.id] });
                }
            });
        }

        // 依據機構名稱進行排序 (中文排序)
        allOrgs.sort((a, b) => {
            const nameA = a.name || '';
            const nameB = b.name || '';
            return nameA.localeCompare(nameB, 'zh-TW');
        });

        selectEl.innerHTML = '';
        if (allOrgs.length === 0) {
            selectEl.innerHTML = '<option value="">目前無可用機構</option>';
            document.getElementById('orgContextArea').style.display = 'none';
        } else {
            allOrgs.forEach(org => {
                const opt = document.createElement('option');
                opt.value = org.id;
                opt.textContent = org.name;
                selectEl.appendChild(opt);
            });
            switcherContainer.classList.remove('d-none');
            
            // 觸發第一次切換
            window.switchOrgContext();
        }
    } catch (error) {
        console.error("載入視角失敗:", error);
    }
}

window.switchOrgContext = async function() {
    const selectedOrgId = document.getElementById('currentOrgSelect').value;
    const orgContextArea = document.getElementById('orgContextArea');
    
    if (!selectedOrgId) {
        orgContextArea.style.display = 'none';
        return;
    }
    
    // 顯示區塊並更新標題
    orgContextArea.style.display = 'flex';
    const selectedOrg = allOrgs.find(o => o.id === selectedOrgId);
    document.querySelectorAll('.current-org-name-display').forEach(el => {
        el.textContent = selectedOrg ? selectedOrg.name : '未知機構';
    });
    
    // 判斷該機構的權限
    const localRole = selectedOrg ? selectedOrg.local_role : 'GUEST';
    const isSuperAdmin = currentUserRole === 'SUPER_ADMIN';
    const isOrgSuperAdmin = localRole === 'ORG_SUPER_ADMIN';
    
    // 動態更新權限徽章 (非全域管理員才切換)
    if (!isSuperAdmin) {
        const roleNameEl = document.getElementById('navUserRole');
        const displayRoleNameEl = document.getElementById('displayRoleName');
        if (isOrgSuperAdmin) {
            roleNameEl.textContent = '單位超級管理員';
            roleNameEl.className = 'badge bg-warning text-dark';
            displayRoleNameEl.textContent = '單位超級管理員';
        } else if (localRole === 'ORG_ADMIN') {
            roleNameEl.textContent = '單位管理員';
            roleNameEl.className = 'badge bg-primary';
            displayRoleNameEl.textContent = '單位管理員';
        } else {
            roleNameEl.textContent = '未授權帳號';
            roleNameEl.className = 'badge bg-secondary';
            displayRoleNameEl.textContent = '未授權帳號';
        }
    }
    
    const generateOtpBtn = document.getElementById('generateOtpBtn');
    if (generateOtpBtn) {
        if (isSuperAdmin || isOrgSuperAdmin) {
            generateOtpBtn.classList.remove('d-none');
        } else {
            generateOtpBtn.classList.add('d-none');
        }
    }
    
    // 控制超級管理員選單區塊顯示邏輯
    if (!isSuperAdmin) {
        const superAdminMenuBlock = document.getElementById('superAdminMenuBlock');
        const navSectionOrgs = document.getElementById('nav-section-orgs');
        const navSectionAdmins = document.getElementById('nav-section-admins');
        const adminSection = document.getElementById('section-admins');
        
        if (isOrgSuperAdmin) {
            // 單位超管：顯示選單區塊，但隱藏「機構管理」，只顯示「系統管理員設定」
            if (superAdminMenuBlock) superAdminMenuBlock.style.display = 'block';
            if (navSectionOrgs) navSectionOrgs.style.display = 'none';
            if (navSectionAdmins) navSectionAdmins.style.display = 'block';
        } else {
            // 一般管理員：完全隱藏特權選單區塊與頁面
            if (superAdminMenuBlock) superAdminMenuBlock.style.display = 'none';
            if (adminSection) {
                // 如果目前正在瀏覽系統管理員設定，強制切回總覽
                if (adminSection.classList.contains('active')) {
                    adminSection.classList.remove('active');
                    const overviewSection = document.getElementById('section-overview');
                    if (overviewSection) overviewSection.classList.add('active');
                } else {
                    adminSection.classList.remove('active');
                }
            }
        }
    }

    try {
        const { doc, getDoc, collection, query, where, getDocs } = window.fs;
        const db = window.firebaseDb;

        // 1. 載入公印
        const orgSnap = await getDoc(doc(db, 'organizations', selectedOrgId));
        if (orgSnap.exists()) {
            const orgData = orgSnap.data();
            const preview = document.getElementById('orgSealPreview');
            if (orgData.seal_url) {
                preview.src = orgData.seal_url;
            } else {
                preview.src = 'assets/logo.png';
            }
        }

        // 2. 載入選舉場次
        const tbody = document.getElementById('electionTableBody');
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">載入中...</td></tr>';
        
        const q = query(collection(db, 'elections'), where('org_id', '==', selectedOrgId));
        const electionsSnap = await getDocs(q);
        
        tbody.innerHTML = '';
        if (electionsSnap.empty) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">尚無選舉場次</td></tr>';
        } else {
            // 將文件存入陣列以便排序
            let elections = [];
            electionsSnap.forEach(doc => {
                elections.push({ id: doc.id, ...doc.data() });
            });
            // 依建立時間反向排序 (新的在上面)
            elections.sort((a, b) => {
                const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
                const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
                return timeB - timeA;
            });

            elections.forEach(election => {
                const isArchived = election.status === 'ARCHIVED';
                const statusBadge = isArchived 
                    ? '<span class="badge bg-secondary">已封存</span>' 
                    : '<span class="badge bg-success">進行中</span>';
                const createDate = election.createdAt ? new Date(election.createdAt.toDate()).toLocaleDateString() : '未知';
                
                const tr = document.createElement('tr');
                if (isArchived) tr.style.opacity = '0.6';

                let actionBtns = '';
                if (isArchived) {
                    actionBtns = `
                        <a href="election_admin.html?id=${election.id}" class="btn btn-sm btn-outline-info">查看結果與報表</a>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteElection('${election.id}', '${election.name}')">徹底刪除</button>
                    `;
                } else {
                    actionBtns = `
                        <a href="election_admin.html?id=${election.id}" class="btn btn-sm btn-primary">進入管理</a>
                        <button class="btn btn-sm btn-outline-warning" onclick="archiveElection('${election.id}', '${election.name}')">封存</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteElection('${election.id}', '${election.name}')">徹底刪除</button>
                    `;
                }

                tr.innerHTML = `
                    <td class="fw-bold">${election.name}</td>
                    <td>${statusBadge}</td>
                    <td>${createDate}</td>
                    <td>${actionBtns}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        // 3. 載入操作紀錄 (Audit Logs)
        const tbodyLog = document.getElementById('auditLogTableBody');
        if (tbodyLog) {
            tbodyLog.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">載入中...</td></tr>';
            const qLog = query(collection(db, 'audit_logs'), where('org_id', '==', selectedOrgId));
            const logsSnap = await getDocs(qLog);
            
            let logs = [];
            logsSnap.forEach(doc => {
                logs.push({ id: doc.id, ...doc.data() });
            });
            
            logs.sort((a, b) => {
                const timeA = a.timestamp ? a.timestamp.toMillis() : 0;
                const timeB = b.timestamp ? b.timestamp.toMillis() : 0;
                return timeB - timeA; // 最新在上
            });
            
            tbodyLog.innerHTML = '';
            if (logs.length === 0) {
                tbodyLog.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">尚無操作紀錄</td></tr>';
            } else {
                logs.forEach(log => {
                    const timeStr = log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : '未知';
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td class="text-nowrap">${timeStr}</td>
                        <td class="text-nowrap">${log.user_name || '未知'}</td>
                        <td class="text-nowrap"><span class="badge bg-secondary">${log.action}</span></td>
                        <td class="text-nowrap">${log.target}</td>
                        <td>${log.details}</td>
                    `;
                    tbodyLog.appendChild(tr);
                });
            }
        }

    } catch (error) {
        console.error("載入機構內容失敗:", error);
        Swal.fire('錯誤', `無法載入機構專屬資料：${error.message}`, 'error');
    }
};

// ==========================================
// 超級管理員專屬功能：載入列表
// ==========================================
async function loadAdminDashboard() {
    try {
        const { collection, getDocs } = window.fs;
        const db = window.firebaseDb;

        // 1. 載入機構列表
        const tbodyOrg = document.getElementById('orgTableBody');
        tbodyOrg.innerHTML = '';
        if (allOrgs.length === 0) {
            tbodyOrg.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">尚無任何機構，請點擊新增</td></tr>';
        } else {
            allOrgs.forEach(org => {
                const sealStatus = org.seal_url ? '<span class="badge bg-success">已上傳</span>' : '<span class="badge bg-warning text-dark">未上傳</span>';
                const createDate = org.createdAt ? new Date(org.createdAt.toDate()).toLocaleDateString() : '未知';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="fw-bold">${org.name}</td>
                    <td>${sealStatus}</td>
                    <td>${createDate}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteOrg('${org.id}', '${org.name}')">刪除</button>
                    </td>
                `;
                tbodyOrg.appendChild(tr);
            });
        }

        // 2. 載入使用者名單
        const usersSnap = await getDocs(collection(db, 'users'));
        allUsers = [];
        const tbodyUser = document.getElementById('adminUsersTableBody');
        tbodyUser.innerHTML = '';

        usersSnap.forEach(doc => {
            const u = doc.data();
            u.uid = doc.id;
            
            if (currentUserRole !== 'SUPER_ADMIN') {
                const uOrgRoles = u.org_roles || {};
                const managedOrgIds = allOrgs.filter(o => o.local_role === 'ORG_SUPER_ADMIN').map(o => o.id);
                const hasOverlap = Object.keys(uOrgRoles).some(id => managedOrgIds.includes(id));
                if (hasOverlap || u.uid === currentUserId) {
                    allUsers.push(u);
                }
            } else {
                allUsers.push(u);
            }
        });

        // 根據角色決定是否顯示「可管轄機構」欄位
        const isGlobalSuperAdmin = currentUserRole === 'SUPER_ADMIN';
        const managedOrgsHeader = document.getElementById('managedOrgsHeader');
        if (managedOrgsHeader) {
            managedOrgsHeader.style.display = isGlobalSuperAdmin ? '' : 'none';
        }

        if (allUsers.length === 0) {
            tbodyUser.innerHTML = `<tr><td colspan="${isGlobalSuperAdmin ? '5' : '4'}" class="text-center text-muted py-3">無其他使用者</td></tr>`;
        } else {
            allUsers.forEach(u => {
                const uOrgRoles = u.org_roles || {};
                
                let roleBadge = '';
                if (u.role === 'SUPER_ADMIN') {
                    roleBadge = '<span class="badge bg-danger"><i class="fas fa-crown"></i> 系統超級管理員</span>';
                } else if (!u.role || u.role === 'GUEST') {
                    roleBadge = '<span class="badge bg-secondary">審核中</span>';
                } else {
                    const hasOrgSuperAdmin = Object.values(uOrgRoles).includes('ORG_SUPER_ADMIN');
                    if (hasOrgSuperAdmin) {
                        roleBadge = '<span class="badge bg-warning text-dark"><i class="fas fa-user-shield"></i> 已授權單位超級管理員</span>';
                    } else {
                        roleBadge = '<span class="badge bg-primary">已授權單位管理員</span>';
                    }
                }
                
                let orgsDisplayArr = [];
                Object.keys(uOrgRoles).forEach(orgId => {
                    const o = allOrgs.find(x => x.id === orgId);
                    if (o) {
                        const localRole = uOrgRoles[orgId] === 'ORG_SUPER_ADMIN' ? '單位超管' : '一般管理員';
                        const badgeColor = uOrgRoles[orgId] === 'ORG_SUPER_ADMIN' ? 'bg-danger' : 'bg-primary';
                        orgsDisplayArr.push(`<div class="mb-1">${o.name} <span class="badge ${badgeColor} ms-1">${localRole}</span></div>`);
                    }
                });
                const orgsDisplay = orgsDisplayArr.length > 0 ? orgsDisplayArr.join('') : '<span class="text-muted">無</span>';

                const note = u.note || '<span class="text-muted">無</span>';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>
                        <div class="d-flex align-items-center">
                            <img src="${u.picture || 'assets/logo.png'}" style="width:30px; border-radius:50%; margin-right:10px;">
                            <span>${u.name}</span>
                        </div>
                    </td>
                    <td>
                        <span class="user-note-display">${note}</span>
                    </td>
                    <td>${roleBadge}</td>
                    ${isGlobalSuperAdmin ? `<td>${orgsDisplay}</td>` : ''}
                    <td>
                        ${isGlobalSuperAdmin ? `<button class="btn btn-sm btn-primary" onclick="openAssignModal('${u.uid}', '${u.name}')">授權/編輯</button>` : ''}
                        <button class="btn btn-sm btn-outline-secondary" onclick="openEditNoteModal('${u.uid}', '${u.name}', '${u.note || ''}')">備註</button>
                        ${ u.uid === currentUserId 
                            ? `<button class="btn btn-sm btn-outline-danger" disabled title="無法刪除自己的帳號">刪除</button>` 
                            : `<button class="btn btn-sm btn-outline-danger" onclick="deleteAdminUser('${u.uid}', '${u.name}')">刪除</button>` 
                        }
                    </td>
                `;
                tbodyUser.appendChild(tr);
            });
        }
    } catch (error) {
        console.error("載入管理員資料失敗:", error);
        Swal.fire('錯誤', '無法載入列表', 'error');
    }
}



    // ==========================================
    // Phase 4: 機構設定與公印管理 (Cropper + 去背 + Base64)
    // ==========================================
    let cropper = null;

    // 處理檔案選擇，開啟裁切 Modal
    document.getElementById('sealFileInput')?.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        // 讀取檔案為 DataURL
        const reader = new FileReader();
        reader.onload = function(event) {
            const imgTarget = document.getElementById('cropImageTarget');
            imgTarget.src = event.target.result;
            
            // 顯示 Modal
            const cropModal = new bootstrap.Modal(document.getElementById('cropSealModal'));
            cropModal.show();

            // 初始化或重置 Cropper (強制 1:1 正方形)
            imgTarget.onload = () => {
                if (cropper) {
                    cropper.destroy();
                }
                cropper = new Cropper(imgTarget, {
                    aspectRatio: 1,
                    viewMode: 1,
                    dragMode: 'move',
                    autoCropArea: 0.8,
                    background: false
                });
            }
        };
        reader.readAsDataURL(file);
    });

    // 當 Modal 關閉時清空 Input，讓下次選同一個檔案也能觸發 change
    document.getElementById('cropSealModal')?.addEventListener('hidden.bs.modal', function () {
        document.getElementById('sealFileInput').value = '';
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
    });

    // 觸發選擇檔案 (原本的上傳按鈕改為觸發 Input)
    document.getElementById('uploadSealBtn')?.addEventListener('click', () => {
        document.getElementById('sealFileInput').click();
    });

    // 印章去背與鮮紅化演算法
    function extractSeal(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // 這裡不讀取 a (data[i+3])，假設背景不透明
            
            // 計算亮度 (0~255)
            const brightness = (r + g + b) / 3;
            
            // 閥值：大於 200 視為背景白色
            if (brightness > 200) {
                data[i + 3] = 0; // 全透明
            } else {
                // 將墨跡轉為鮮紅色
                data[i] = 220;   // R (使用亮紅色)
                data[i + 1] = 30;// G
                data[i + 2] = 30;// B
                
                // 依據原本的深度設定透明度 (保留邊緣平滑)
                // 亮度 0 = 最深 (alpha 255)
                // 亮度 200 = 最淺 (alpha 0)
                const opacity = 255 - (brightness * (255 / 200));
                data[i + 3] = Math.min(255, Math.max(0, opacity));
            }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    // 確認裁切並儲存 Base64 到 Firestore
    document.getElementById('confirmCropBtn')?.addEventListener('click', async () => {
        if (!cropper) return;
        
        const orgId = document.getElementById('currentOrgSelect').value;
        if (!orgId) {
            Swal.fire('錯誤', '找不到當前機構 ID', 'error');
            return;
        }

        const btn = document.getElementById('confirmCropBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 處理中...';

        try {
            // 1. 取得裁切後的 Canvas (設定固定輸出大小，確保檔案夠小)
            const croppedCanvas = cropper.getCroppedCanvas({
                width: 300,
                height: 300,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high',
            });

            // 2. 進行去背與鮮紅化
            const processedCanvas = extractSeal(croppedCanvas);

            // 3. 轉為 Base64 (PNG格式)
            const base64String = processedCanvas.toDataURL('image/png');
            
            // 4. 計算容量大小 (Base64 大約等於字串長度 * 3/4)
            const sizeInBytes = Math.round(base64String.length * 3 / 4);
            const sizeInKB = (sizeInBytes / 1024).toFixed(1);
            
            document.getElementById('cropSizeHint').textContent = `處理後大小: ${sizeInKB} KB`;

            if (sizeInKB > 800) {
                throw new Error(`圖片過大 (${sizeInKB} KB)，請重試！上限為 800 KB。`);
            }

            // 5. 寫入 Firestore
            const { doc, updateDoc } = window.fs;
            const db = window.firebaseDb;
            await updateDoc(doc(db, 'organizations', orgId), {
                seal_url: base64String
            });

            Swal.fire('成功', `公印已自動去背並成功儲存！(大小: ${sizeInKB} KB)`, 'success');
            
            // 寫入 Audit Log
            if (window.logAuditAction) {
                await window.logAuditAction(orgId, 'UPDATE', '公印', `上傳並更新了機構公印 (大小: ${sizeInKB} KB)`);
            }
            
            // 關閉 Modal
            const modalEl = document.getElementById('cropSealModal');
            bootstrap.Modal.getInstance(modalEl).hide();
            
            // 更新畫面預覽
            window.switchOrgContext();

        } catch (error) {
            console.error('儲存公印失敗:', error);
            Swal.fire('錯誤', error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '確認裁切並上傳';
        }
    });

    // 新增選舉
    document.getElementById('saveElectionBtn')?.addEventListener('click', async () => {
        const orgId = document.getElementById('currentOrgSelect').value;
        const electionName = document.getElementById('electionNameInput').value.trim();

        if (!orgId) {
            Swal.fire('提示', '請先選擇機構', 'warning');
            return;
        }
        if (!electionName) {
            Swal.fire('提示', '請填寫選舉名稱', 'warning');
            return;
        }

        try {
            const btn = document.getElementById('saveElectionBtn');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 建立中...';

            const { collection, addDoc, serverTimestamp } = window.fs;
            const db = window.firebaseDb;

            await addDoc(collection(db, 'elections'), {
                org_id: orgId,
                name: electionName,
                status: 'ACTIVE',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            Swal.fire('成功', '已成功建立選舉場次！', 'success');
            
            if (window.logAuditAction) {
                await window.logAuditAction(orgId, 'CREATE', '選舉', `建立了新的選舉場次: ${electionName}`);
            }
            
            const modalEl = document.getElementById('createElectionModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
            document.getElementById('createElectionForm').reset();
            
            // 重新載入列表
            window.switchOrgContext();

        } catch (error) {
            console.error('新增選舉失敗:', error);
            Swal.fire('錯誤', '新增失敗: ' + error.message, 'error');
        } finally {
            const btn = document.getElementById('saveElectionBtn');
            btn.disabled = false;
            btn.textContent = '建立選舉';
        }
    });

    // 封存選舉
    window.archiveElection = function(electionId, electionName) {
        Swal.fire({
            title: '確定要封存此選舉嗎？',
            html: `封存後 <b>${electionName}</b> 將無法再進行投票或修改，但紀錄會保留。<br>若要重新啟用，請聯絡系統管理員。`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ffc107',
            cancelButtonColor: '#6c757d',
            confirmButtonText: '是的，我要封存',
            cancelButtonText: '取消'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const { doc, updateDoc, serverTimestamp } = window.fs;
                    const db = window.firebaseDb;
                    
                    await updateDoc(doc(db, 'elections', electionId), {
                        status: 'ARCHIVED',
                        updatedAt: serverTimestamp()
                    });
                    
                    Swal.fire('成功', '已封存', 'success');
                    
                    const currentOrgId = document.getElementById('currentOrgSelect').value;
                    if (window.logAuditAction && currentOrgId) {
                        await window.logAuditAction(currentOrgId, 'ARCHIVE', '選舉', `封存了選舉場次: ${electionName}`);
                    }
                    
                    window.switchOrgContext();
                } catch (error) {
                    Swal.fire('錯誤', error.message, 'error');
                }
            }
        });
    };

    // 徹底刪除選舉
    window.deleteElection = function(electionId, electionName) {
        Swal.fire({
            title: '徹底刪除確認',
            html: `這將徹底刪除 <b>${electionName}</b> 的所有資料。<br><span class="text-danger">⚠️ 注意：此操作無法復原！</span>`,
            icon: 'error',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#6c757d',
            confirmButtonText: '確定刪除',
            cancelButtonText: '取消'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const { doc, deleteDoc } = window.fs;
                    const db = window.firebaseDb;
                    
                    await deleteDoc(doc(db, 'elections', electionId));
                    
                    Swal.fire('成功', '已刪除', 'success');

                    const currentOrgId = document.getElementById('currentOrgSelect').value;
                    if (window.logAuditAction && currentOrgId) {
                        await window.logAuditAction(currentOrgId, 'DELETE', '選舉', `徹底刪除了選舉場次: ${electionName}`);
                    }
                    
                    window.switchOrgContext();
                } catch (error) {
                    Swal.fire('錯誤', error.message, 'error');
                }
            }
        });
    };

    // 建立新機構
    document.getElementById('saveOrgBtn')?.addEventListener('click', async () => {
        const orgName = document.getElementById('orgNameInput').value.trim();

        if (!orgName) {
            Swal.fire('提示', '請填寫機構名稱', 'warning');
            return;
        }

        try {
            const { collection, addDoc, serverTimestamp } = window.fs;
            const db = window.firebaseDb;
            const saveBtn = document.getElementById('saveOrgBtn');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 建立中...';

            const newOrgRef = await addDoc(collection(db, 'organizations'), {
                name: orgName,
                seal_url: null,
                createdAt: serverTimestamp()
            });

            Swal.fire('成功', '已成功建立機構！', 'success');
            
            if (window.logAuditAction) {
                await window.logAuditAction(newOrgRef.id, 'CREATE', '機構', `建立了新的機構: ${orgName}`);
            }
            
            const modalEl = document.getElementById('createOrgModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
            document.getElementById('createOrgForm').reset();
            
            // 重新載入全域資料
            await loadOrgSwitcher('SUPER_ADMIN', []);
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
                    const response = await fetch(`${API_BASE_URL}/admin/organizations/${orgId}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${idToken}`
                        }
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        Swal.fire('已刪除', '機構與相關資料已成功刪除', 'success');
                        
                        // 注意：因為機構已經被刪除，紀錄寫在哪個機構已經無意義，
                        // 但如果是保留全域紀錄，可以在超級管理員介面看到，這裡選擇不寫入或寫入已被刪除的 ID 供後續追蹤
                        if (window.logAuditAction) {
                            await window.logAuditAction(orgId, 'DELETE', '機構', `徹底刪除機構及其所有選舉: ${orgName}`);
                        }
                        
                        await loadOrgSwitcher('SUPER_ADMIN', []);
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
        
        const superToggle = document.getElementById('superAdminToggle');
        const orgSelectionBlock = document.getElementById('orgSelectionBlock');
        const superToggleBlock = document.getElementById('superAdminToggleBlock');
        
        if (currentUserRole !== 'SUPER_ADMIN') {
            if (superToggleBlock) superToggleBlock.style.display = 'none';
        } else {
            if (superToggleBlock) superToggleBlock.style.display = 'block';
        }
        
        if (targetUser.role === 'SUPER_ADMIN') {
            superToggle.checked = true;
            orgSelectionBlock.style.display = 'none';
        } else {
            superToggle.checked = false;
            orgSelectionBlock.style.display = 'block';
        }

        const container = document.getElementById('orgRolesContainer');
        container.innerHTML = '';

        if (allOrgs.length === 0) {
            container.innerHTML = '<p class="text-muted p-3">尚無任何機構可供授權</p>';
        } else {
            const userOrgRoles = targetUser.org_roles || {};
            allOrgs.forEach(org => {
                const currentRole = userOrgRoles[org.id] || '';
                container.innerHTML += `
                    <div class="d-flex justify-content-between p-3 border-bottom align-items-center">
                        <span class="fw-bold">${org.name}</span>
                        <select class="form-select form-select-sm w-auto org-role-select" data-org-id="${org.id}">
                            <option value="" ${currentRole === '' ? 'selected' : ''}>無權限</option>
                            <option value="ORG_ADMIN" ${currentRole === 'ORG_ADMIN' ? 'selected' : ''}>一般管理員</option>
                            <option value="ORG_SUPER_ADMIN" ${currentRole === 'ORG_SUPER_ADMIN' ? 'selected' : ''}>單位超級管理員</option>
                        </select>
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

        const selects = document.querySelectorAll('.org-role-select');
        const org_roles = {};
        selects.forEach(select => {
            if (select.value) {
                org_roles[select.dataset.orgId] = select.value;
            }
        });

        try {
            const btn = document.getElementById('saveAssignBtn');
            btn.disabled = true;
            btn.textContent = '儲存中...';

            let newRole = 'GUEST';
            if (document.getElementById('superAdminToggle').checked) {
                newRole = 'SUPER_ADMIN';
            } else {
                newRole = Object.keys(org_roles).length > 0 ? 'USER' : 'GUEST';
            }

            // 取得目前的 Firebase ID Token
            const idToken = await window.firebaseAuth.currentUser.getIdToken(true);

            // 呼叫後端 API，同時更新 Firestore 與 Firebase Auth Custom Claims
            const response = await fetch(`${API_BASE_URL}/admin/update_user_claims`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    targetUid: uid,
                    newRole: newRole,
                    org_roles: org_roles
                })
            });

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.message);
            }

            Swal.fire('成功', '權限設定已儲存！對方重新整理頁面後即可生效。', 'success');
            
            // 針對每個被授權的機構寫入操作紀錄
            if (window.logAuditAction) {
                for (const oid of Object.keys(org_roles)) {
                    await window.logAuditAction(oid, 'UPDATE', '權限', `授權權限 (${org_roles[oid]}) 給: ${document.getElementById('assignTargetName').textContent}`);
                }
            }
            
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

    // 刪除系統管理員
    window.deleteAdminUser = function(uid, name) {
        Swal.fire({
            title: '確定要刪除此帳號嗎？',
            html: `您即將永久刪除 <b>${name}</b> 的帳號與所有權限。<br><br><span class="text-danger fw-bold">⚠️ 警告：刪除後對方將無法登入系統！</span>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: '是的，我要徹底刪除',
            cancelButtonText: '取消'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const idToken = await window.firebaseAuth.currentUser.getIdToken(true);
                    
                    const response = await fetch(`${API_BASE_URL}/admin/users/${uid}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${idToken}`
                        }
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        Swal.fire('已刪除', '使用者帳號已成功刪除', 'success');
                        loadAdminDashboard();
                    } else {
                        throw new Error(data.message || '伺服器拒絕刪除');
                    }
                } catch (error) {
                    console.error("刪除使用者失敗:", error);
                    Swal.fire('刪除失敗', error.message, 'error');
                }
            }
        });
    };

    // 開啟編輯備註 Modal
    window.openEditNoteModal = function(uid, name, currentNote) {
        document.getElementById('editNoteTargetName').textContent = name;
        document.getElementById('editNoteTargetUid').value = uid;
        document.getElementById('editNoteInput').value = currentNote || '';
        
        const modal = new bootstrap.Modal(document.getElementById('editNoteModal'));
        modal.show();
    };

    // 儲存備註
    document.getElementById('saveNoteBtn')?.addEventListener('click', async () => {
        const uid = document.getElementById('editNoteTargetUid').value;
        const newNote = document.getElementById('editNoteInput').value.trim();
        
        if (!uid) return;

        try {
            const btn = document.getElementById('saveNoteBtn');
            btn.disabled = true;
            btn.textContent = '儲存中...';

            const { doc, updateDoc } = window.fs;
            const db = window.firebaseDb;
            
            await updateDoc(doc(db, 'users', uid), {
                note: newNote
            });

            Swal.fire('成功', '備註已更新', 'success');
            bootstrap.Modal.getInstance(document.getElementById('editNoteModal')).hide();
            
            // 重新載入列表以更新畫面
            loadAdminDashboard();
            
        } catch (error) {
            console.error("更新備註失敗:", error);
            Swal.fire('錯誤', error.message, 'error');
        } finally {
            const btn = document.getElementById('saveNoteBtn');
            btn.disabled = false;
            btn.textContent = '儲存備註';
        }
    });



// ==========================================
// 依據角色啟動對應功能
// ==========================================
function applyRoleUI(role, org_ids) {
    currentUserRole = role;
    const roleNameEl = document.getElementById('navUserRole');
    const displayRoleNameEl = document.getElementById('displayRoleName');
    const contentEl = document.getElementById('dashboardContent');
    const noAccessEl = document.getElementById('noAccessContent');

    // 移除舊的權限 class
    document.body.classList.remove('is-super-admin', 'is-org-admin');


    if (role === 'SUPER_ADMIN') {
        roleNameEl.textContent = '系統超級管理員';
        roleNameEl.className = 'badge bg-danger';
        displayRoleNameEl.textContent = '系統超級管理員';
        
        document.body.classList.add('is-super-admin');
        contentEl.style.display = 'block';

        loadOrgSwitcher(role, org_ids).then(() => loadAdminDashboard());

    } else if (role === 'ORG_ADMIN' || role === 'USER' || Object.keys(org_ids || {}).length > 0) {
        roleNameEl.textContent = '單位管理員';
        roleNameEl.className = 'badge bg-primary';
        displayRoleNameEl.textContent = '單位管理員';
        
        document.body.classList.add('is-org-admin');
        contentEl.style.display = 'block';

        loadOrgSwitcher(role, org_ids).then(() => {
            // 如果具備任何單位的超管權限，則需要載入管理員列表
            const isAnyOrgSuperAdmin = Object.values(org_ids || {}).includes('ORG_SUPER_ADMIN');
            if (isAnyOrgSuperAdmin) {
                loadAdminDashboard();
            }
        });

    } else {
        // GUEST 或未知權限，強制顯示輸入序號 Modal
        roleNameEl.textContent = '未授權帳號';
        roleNameEl.className = 'badge bg-secondary';
        
        contentEl.style.display = 'none';
        noAccessEl.style.display = 'none'; // 完全隱藏原本的審核中畫面
        
        // 自動彈出序號輸入視窗
        window.showOtpInputModal();
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

// ==========================================
// 授權碼機制 (OTP)
// ==========================================

let otpTimerInterval = null;

window.showOtpInputModal = function() {
    const modal = new bootstrap.Modal(document.getElementById('otpInputModal'));
    const closeBtn = document.getElementById('closeOtpInputBtn');
    
    document.getElementById('otpInputField').value = '';
    document.getElementById('otpErrorAlert').classList.add('d-none');
    
    if (currentUserRole !== 'GUEST') {
        closeBtn.classList.remove('d-none');
    } else {
        closeBtn.classList.add('d-none');
    }
    
    modal.show();
};

window.verifyOtpCode = async function() {
    const code = document.getElementById('otpInputField').value.trim();
    const errorAlert = document.getElementById('otpErrorAlert');
    const errorMsg = document.getElementById('otpErrorMsg');
    const btn = document.getElementById('verifyOtpBtn');
    
    if (code.length !== 6) {
        errorMsg.textContent = '請輸入完整的 6 位數授權碼';
        errorAlert.classList.remove('d-none');
        return;
    }
    
    try {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 驗證中...';
        errorAlert.classList.add('d-none');
        
        const token = await window.firebaseAuth.currentUser.getIdToken(true);
        const response = await fetch(`${API_BASE_URL}/auth/verify_auth_code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ code })
        });
        
        const result = await response.json();
        
        if (result.success) {
            Swal.fire({
                icon: 'success',
                title: '驗證成功',
                text: result.message,
                timer: 1500,
                showConfirmButton: false
            }).then(async () => {
                await window.firebaseAuth.currentUser.getIdToken(true); // 強制更新 token
                window.location.reload();
            });
        } else {
            errorMsg.textContent = result.message;
            errorAlert.classList.remove('d-none');
        }
    } catch (error) {
        errorMsg.textContent = '系統連線發生錯誤，請稍後再試';
        errorAlert.classList.remove('d-none');
    } finally {
        btn.disabled = false;
        btn.textContent = '立即驗證';
    }
};

window.generateOtpCode = async function() {
    const orgId = document.getElementById('currentOrgSelect').value;
    if (!orgId) {
        Swal.fire('錯誤', '請先選擇欲產生序號的機構', 'error');
        return;
    }
    
    const modalEl = document.getElementById('generateOtpModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
    
    document.getElementById('otpLoadingArea').classList.remove('d-none');
    document.getElementById('otpDisplayArea').classList.add('d-none');
    
    if (otpTimerInterval) clearInterval(otpTimerInterval);
    
    try {
        const token = await window.firebaseAuth.currentUser.getIdToken();
        const response = await fetch(`${API_BASE_URL}/admin/generate_auth_code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ orgId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            document.getElementById('otpLoadingArea').classList.add('d-none');
            document.getElementById('otpDisplayArea').classList.remove('d-none');
            document.getElementById('generatedOtpCode').textContent = result.code;
            
            const expiresAt = result.expiresAt;
            const progressBar = document.getElementById('otpProgressBar');
            const timerText = document.getElementById('otpTimerText');
            
            // 倒數計時 5 分鐘 (300 秒)
            const totalDuration = 5 * 60 * 1000;
            
            otpTimerInterval = setInterval(() => {
                const now = new Date().getTime();
                const remaining = expiresAt - now;
                
                if (remaining <= 0) {
                    clearInterval(otpTimerInterval);
                    timerText.textContent = '序號已過期';
                    progressBar.style.width = '0%';
                    progressBar.classList.remove('bg-danger');
                    progressBar.classList.add('bg-secondary');
                    document.getElementById('generatedOtpCode').classList.add('text-muted');
                    document.getElementById('generatedOtpCode').classList.remove('text-success');
                } else {
                    const seconds = Math.floor((remaining / 1000) % 60);
                    const minutes = Math.floor((remaining / 1000) / 60);
                    timerText.textContent = `剩餘時間：0${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                    const percentage = (remaining / totalDuration) * 100;
                    progressBar.style.width = percentage + '%';
                }
            }, 1000);
            
            // 當 modal 關閉時清除計時器
            modalEl.addEventListener('hidden.bs.modal', function () {
                if (otpTimerInterval) clearInterval(otpTimerInterval);
            }, { once: true });
            
        } else {
            modal.hide();
            Swal.fire('錯誤', result.message, 'error');
        }
    } catch (error) {
        modal.hide();
        Swal.fire('錯誤', '無法產生序號: ' + error.message, 'error');
    }
};

// 側邊欄導覽切換邏輯
document.querySelectorAll('.nav-link-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        
        // 更新按鈕 active 狀態
        document.querySelectorAll('.nav-link-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // 隱藏所有 section
        document.querySelectorAll('.nav-section').forEach(sec => sec.classList.remove('active'));
        
        // 顯示目標 section
        const targetId = btn.getAttribute('data-target');
        const targetSec = document.getElementById(targetId);
        if (targetSec) {
            targetSec.classList.add('active');
            
            // 如果是手機版，點擊後自動收起側邊欄
            if (window.innerWidth < 768) {
                const sidebar = document.getElementById('sidebarMenu');
                if (sidebar) sidebar.classList.add('d-none');
            }
        }
    });
});

// 處理手機版側邊欄切換
const mobileMenuBtn = document.getElementById('mobileMenuToggle');
if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebarMenu');
        if (sidebar) {
            sidebar.classList.toggle('d-none');
        }
    });
}
