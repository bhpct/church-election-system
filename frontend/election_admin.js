const API_BASE_URL = "https://church-election-system-1089220354332.asia-east1.run.app/api";

let currentElectionId = null;
let currentElectionData = null;
let currentOrgData = null;
let currentUserRole = 'GUEST';
let currentUserOrgIds = [];

// 快取資料
let allCandidates = [];
let allItems = [];

// 從 URL 取得參數
const urlParams = new URLSearchParams(window.location.search);
currentElectionId = urlParams.get('id');

if (!currentElectionId) {
    showError('未提供選舉 ID');
}

// 監聽導覽列點擊
document.querySelectorAll('.nav-link-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-link-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.nav-section').forEach(s => s.classList.remove('active'));
        
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
        
        // 切換到預覽時，更新選項
        if (targetId === 'section-preview') {
            updatePreviewSelects();
        }
    });
});

// 監聽 Firebase Auth 狀態
document.addEventListener('DOMContentLoaded', () => {
    // 等待 Firebase 載入
    const checkFirebase = setInterval(() => {
        if (window.firebaseAuth && window.onAuthStateChanged) {
            clearInterval(checkFirebase);
            initSystem();
        }
    }, 100);
});

// 全域選舉進階設定儲存邏輯
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('confirmSaveSettingsBtn')?.addEventListener('click', async () => {
        try {
            const { doc, updateDoc, writeBatch } = window.fs;
            const db = window.firebaseDb;
            
            const btn = document.getElementById('confirmSaveSettingsBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 儲存中...';

            const baseElement = document.querySelector('input[name="globalQuorumBase"]:checked');
            const quorumBase = baseElement ? baseElement.value : 'ATTENDING';
            const initAttending = parseInt(document.getElementById('globalInitAttending').value) || null;

            // 1. 寫入全域選舉設定 (不更動 status)
            await updateDoc(doc(db, 'elections', currentElectionId), {
                quorum_base: quorumBase,
                init_attending_count: initAttending,
                updatedAt: window.fs.serverTimestamp()
            });

            // 2. 連動更新所有已建立的輪次
            if (allItems.length > 0) {
                const batch = writeBatch(db);
                for (const item of allItems) {
                    for (const round of item.rounds) {
                        const roundRef = doc(db, 'elections', currentElectionId, 'items', item.id, 'rounds', round.id);
                        batch.set(roundRef, {
                            quorum_base: quorumBase,
                            attending_count: initAttending || 0,
                            updatedAt: window.fs.serverTimestamp()
                        }, { merge: true });
                    }
                }
                await batch.commit();
            }

            Swal.fire('儲存成功', '預設參數已更新，並成功同步至所有輪次！', 'success').then(() => {
                window.location.reload();
            });

        } catch (error) {
            console.error("儲存參數失敗:", error);
            Swal.fire('錯誤', error.message, 'error');
            const btn = document.getElementById('confirmSaveSettingsBtn');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 儲存設定';
        }
    });
});

function initSystem() {
    window.onAuthStateChanged(window.firebaseAuth, async (user) => {
        if (user) {
            try {
                // 強制取得最新的 Custom Claims
                const tokenResult = await user.getIdTokenResult(true);
                currentUserRole = tokenResult.claims.role || 'GUEST';
                currentUserOrgIds = tokenResult.claims.org_ids || [];
                
                // 載入選舉資料
                await loadElectionData();
            } catch (error) {
                console.error("登入權限載入失敗:", error);
                showError("無法取得權限資訊");
            }
        } else {
            // 未登入，導向首頁
            window.location.href = 'index.html';
        }
    });
}

function showError(msg) {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('mainContainer').style.display = 'none';
    document.getElementById('errorView').style.display = 'block';
    if (msg) document.getElementById('errorMsg').textContent = msg;
}

async function loadElectionData() {
    try {
        const { doc, getDoc, collection, getDocs } = window.fs;
        const db = window.firebaseDb;

        // 1. 取得選舉資料
        const electionRef = doc(db, 'elections', currentElectionId);
        const electionSnap = await getDoc(electionRef);

        if (!electionSnap.exists()) {
            showError('找不到該選舉場次');
            return;
        }

        currentElectionData = electionSnap.data();

        // 2. 權限驗證
        const orgId = currentElectionData.org_id;
        if (currentUserRole !== 'SUPER_ADMIN' && !currentUserOrgIds.includes(orgId)) {
            showError('您沒有權限管理此單位的選舉');
            return;
        }

        // 3. 取得機構資料 (為了公印與名稱)
        const orgSnap = await getDoc(doc(db, 'organizations', orgId));
        if (orgSnap.exists()) {
            currentOrgData = orgSnap.data();
            document.getElementById('orgNameBadge').textContent = currentOrgData.name;
        }

        // 4. 更新畫面文字與狀態
        document.getElementById('sidebarElectionName').textContent = currentElectionData.name;
        document.getElementById('pageTitle').textContent = `管理：${currentElectionData.name}`;

        const status = currentElectionData.status || 'PENDING';
        const statusBadge = document.getElementById('globalElectionStatusBadge');
        if (status === 'PENDING') {
            statusBadge.textContent = '準備中';
            statusBadge.className = 'badge bg-secondary me-2';
        } else {
            statusBadge.textContent = status === 'ACTIVE' ? '投票中' : (status === 'CLOSED' ? '開票中' : '結果發布');
            statusBadge.className = status === 'ACTIVE' ? 'badge bg-success me-2' : 'badge bg-warning text-dark me-2';
        }

        // 初始化進階設定的表單值
        if (currentElectionData.quorum_base) {
            const radioBtn = document.querySelector(`input[name="globalQuorumBase"][value="${currentElectionData.quorum_base}"]`);
            if (radioBtn) radioBtn.checked = true;
        }
        if (currentElectionData.init_attending_count !== undefined && currentElectionData.init_attending_count !== null) {
            document.getElementById('globalInitAttending').value = currentElectionData.init_attending_count;
        }


        // 5. 載入子集合資料
        await loadCandidates();
        await loadItems();

        // 隱藏 Loader，顯示主內容
        document.getElementById('loader').style.display = 'none';
        document.getElementById('mainContainer').style.display = 'block';

    } catch (error) {
        console.error("載入資料失敗:", error);
        showError('載入失敗: ' + error.message);
    }
}

// ==========================================
// 候選人資料庫 (Excel 匯入與展示)
// ==========================================

async function loadCandidates() {
    const { collection, getDocs } = window.fs;
    const db = window.firebaseDb;
    const candidatesRef = collection(db, 'elections', currentElectionId, 'candidates');
    const snap = await getDocs(candidatesRef);
    
    allCandidates = [];
    snap.forEach(doc => {
        allCandidates.push({ id: doc.id, ...doc.data() });
    });
    
    // 依號碼排序
    allCandidates.sort((a, b) => {
        const numA = parseInt(a.number) || 0;
        const numB = parseInt(b.number) || 0;
        return numA - numB;
    });

    document.getElementById('statCandidates').textContent = allCandidates.length;
    renderCandidatesTable();
    updateDynamicFormOptions(); // 更新 Modal 的動態選項 (資格、強制候選)
    
    // 自動同步最新名單到所有尚未開始的輪次
    await window.syncPendingRoundsWithGlobalCandidates();
}

window.syncPendingRoundsWithGlobalCandidates = async function() {
    if (!allItems || allItems.length === 0) return; // 頁面初次載入時還沒有 items，直接跳過
    if (typeof isElectionLocked !== 'undefined' && isElectionLocked) return; // 若選舉已鎖定，跳過

    try {
        const { doc, writeBatch } = window.fs;
        const db = window.firebaseDb;
        const batch = writeBatch(db);
        let updatesCount = 0;

        for (const item of allItems) {
            // 計算這個 item 該有的預設候選人
            let initialCandidateIds = allCandidates.filter(c => {
                if (c.is_ineligible) return false; // 全域不可被選
                if (item.exclude_elected && c.elected_item && c.elected_item.trim() !== '') return false; // 排除已當選
                if (item.qualifications && item.qualifications.length > 0 && !item.qualifications.includes(c.qualification)) return false; // 資格不符
                return true;
            }).map(c => c.id);

            // 若有保障名額，強制加入
            if (item.forced_candidate_id && !initialCandidateIds.includes(item.forced_candidate_id)) {
                initialCandidateIds.push(item.forced_candidate_id);
            }

            // 針對該項次下所有 PENDING 狀態的輪次進行同步
            if (item.rounds) {
                for (const roundData of item.rounds) {
                    if (roundData.status === 'PENDING') {
                        const roundRef = doc(db, 'elections', currentElectionId, 'items', item.id, 'rounds', roundData.id);
                        batch.update(roundRef, { candidate_ids: initialCandidateIds });
                        updatesCount++;
                        
                        // 更新記憶體資料
                        roundData.candidate_ids = initialCandidateIds; 
                    }
                }
            }
        }
        
        if (updatesCount > 0) {
            await batch.commit();
            console.log(`自動同步：已將全域候選人名單更新至 ${updatesCount} 個未開始的輪次`);
            if (typeof renderItemsAccordion === 'function') {
                renderItemsAccordion(); // 重新渲染畫面以顯示正確的候選人數
            }
        }
    } catch (error) {
        console.error("自動同步輪次候選人失敗:", error);
    }
}

function renderCandidatesTable() {
    const tbody = document.getElementById('candidatesTableBody');
    tbody.innerHTML = '';
    
    if (allCandidates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">尚無資料，請匯入或新增</td></tr>';
        return;
    }

    allCandidates.forEach(c => {
        const photoHtml = c.photo_base64 
            ? `<img src="${c.photo_base64}" class="candidate-img-preview">` 
            : `<div class="candidate-img-preview d-flex align-items-center justify-content-center text-muted"><i class="fas fa-user"></i></div>`;
            
        const districtHtml = c.district ? `<span class="badge bg-info">${c.district}</span>` : '<span class="text-muted">-</span>';
        const electedHtml = c.elected_item ? `<span class="badge bg-warning text-dark"><i class="fas fa-trophy"></i> ${c.elected_item}</span>` : '<span class="text-muted">-</span>';
        const statusHtml = c.is_ineligible ? `<span class="badge bg-danger"><i class="fas fa-times"></i> 不可被選</span>` : `<span class="badge bg-success">正常</span>`;
        
        tbody.innerHTML += `
            <tr>
                <td>${photoHtml}</td>
                <td class="fw-bold">${c.number}</td>
                <td>${c.name}</td>
                <td><span class="badge bg-secondary">${c.qualification}</span></td>
                <td>${districtHtml}</td>
                <td>${electedHtml}</td>
                <td>${statusHtml}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="openEditCandidate('${c.id}')"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm btn-outline-danger delete-cand-btn" onclick="deleteCandidate('${c.id}')" ${isElectionLocked ? 'disabled' : ''}><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

// 下載 Excel 範本
document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
    // 建立範本資料
    const templateData = [
        ["編號", "姓名", "分區", "單位", "候選資格"],
        ["1", "王大明", "東區", "第一教會", "牧師"],
        ["2", "李小華", "西區", "第二教會", "長老"],
        ["3", "陳阿信", "", "青年團契", "長執候選人"]
    ];

    // 轉換為工作表
    const ws = XLSX.utils.aoa_to_sheet(templateData);
    
    // 設定欄寬
    ws['!cols'] = [
        { wch: 10 }, // 編號
        { wch: 15 }, // 姓名
        { wch: 15 }, // 分區
        { wch: 20 }, // 單位
        { wch: 20 }  // 候選資格
    ];

    // 建立工作簿
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "候選人名單");

    // 匯出檔案
    XLSX.writeFile(wb, "候選人匯入範本.xlsx");
});

// Excel 檔案上傳解析
document.getElementById('excelUpload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 檢查是否有項次設定了保障名額，若有則禁止匯入 (因為匯入會清空原本的候選人，導致保障名額 ID 遺失)
    if (allItems && allItems.length > 0) {
        const itemsWithForced = allItems.filter(i => i.forced_candidate_id);
        if (itemsWithForced.length > 0) {
            const itemNames = itemsWithForced.map(i => i.title).join('、');
            Swal.fire('錯誤', `目前有項次（${itemNames}）設定了保障名額，匯入 Excel 會清空舊資料導致保障名額遺失而發生錯誤！請先至「選舉項次」移除這些保障設定後，再執行匯入。`, 'error');
            e.target.value = '';
            return;
        }
    }

    Swal.fire({
        title: '確定要匯入覆蓋？',
        text: '這將會【清空】目前資料庫中所有的候選人名單，並完全替換為本次上傳的檔案。若有正在進行的投票將受影響，確定要繼續嗎？',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: '確定覆蓋',
        cancelButtonText: '取消'
    }).then((result) => {
        if (result.isConfirmed) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // 轉為 JSON 陣列， header: 1 表示將第一列視為陣列，不使用物件 key
                const rows = XLSX.utils.sheet_to_json(worksheet, {header: 1});
                
                if (rows.length < 2) {
                    Swal.fire('錯誤', 'Excel 內容為空或無有效標題', 'error');
                    return;
                }

                processExcelData(rows);
            };
            reader.readAsArrayBuffer(file);
        }
        // 重置 input，允許重複上傳同一個檔案
        e.target.value = '';
    });
});

async function processExcelData(rows) {
    let validCount = 0;
    Swal.fire({
        title: '匯入中...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        const { collection, doc, writeBatch, serverTimestamp, getDocs } = window.fs;
        const db = window.firebaseDb;
        const candidatesRef = collection(db, 'elections', currentElectionId, 'candidates');

        // 1. 刪除舊有候選人資料
        const existingSnap = await getDocs(candidatesRef);
        if (!existingSnap.empty) {
            let deleteBatch = writeBatch(db);
            let delCount = 0;
            existingSnap.forEach(docSnap => {
                deleteBatch.delete(docSnap.ref);
                delCount++;
                // 若未來刪除超過500筆，需分批，此處假設一般教會選舉不會單次超過500名候選人
            });
            await deleteBatch.commit();
        }

        // 2. 批次寫入新候選人資料
        let insertBatch = writeBatch(db);
        let batchOpCount = 0;
        const batches = [insertBatch];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 2 || !row[1]) continue; // 姓名不能為空
            
            const candidateData = {
                number: row[0] ? String(row[0]).trim() : '',
                name: row[1] ? String(row[1]).trim() : '',
                district: row[2] ? String(row[2]).trim() : '',
                unit: row[3] ? String(row[3]).trim() : '',
                qualification: row[4] ? String(row[4]).trim() : '',
                createdAt: serverTimestamp()
            };
            
            const newRef = doc(candidatesRef);
            insertBatch.set(newRef, candidateData);
            
            validCount++;
            batchOpCount++;

            if (batchOpCount >= 450) {
                insertBatch = writeBatch(db);
                batches.push(insertBatch);
                batchOpCount = 0;
            }
        }

        for (const b of batches) {
            await b.commit();
        }

        Swal.fire('成功', `已清空舊資料並成功匯入 ${validCount} 筆新候選人資料！`, 'success');
        
        await loadCandidates(); // 重新載入列表
    } catch (error) {
        console.error("匯入失敗:", error);
        Swal.fire('錯誤', '匯入過程中發生錯誤: ' + error.message, 'error');
    }
}

window.deleteCandidate = async function(id) {
    // 檢查是否為保障名額，若是則不允許刪除
    if (allItems && allItems.length > 0) {
        for (const item of allItems) {
            if (item.forced_candidate_id === id) {
                Swal.fire('錯誤', `此候選人已被設定為【${item.title}】的保障名額，無法刪除！若要刪除，請先至該項次移除保障設定。`, 'error');
                return;
            }
        }
    }

    const result = await Swal.fire({
        title: '確定刪除？',
        text: "【注意】這將會同步從所有未開始投票的選舉輪次中移除此候選人！刪除後無法復原，是否確定？",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: '確定刪除'
    });

    if (result.isConfirmed) {
        try {
            const { doc, deleteDoc } = window.fs;
            const db = window.firebaseDb;
            await deleteDoc(doc(db, 'elections', currentElectionId, 'candidates', id));
            await loadCandidates();
        } catch (error) {
            Swal.fire('錯誤', error.message, 'error');
        }
    }
}

// 單筆新增候選人儲存邏輯
document.getElementById('saveCandidateBtn').addEventListener('click', async () => {
    const number = document.getElementById('candNumberInput').value.trim();
    const name = document.getElementById('candNameInput').value.trim();
    const district = document.getElementById('candDistrictInput').value.trim();
    const unit = document.getElementById('candUnitInput').value.trim();
    const qualification = document.getElementById('candQualInput').value.trim();

    if (!name || !qualification) {
        Swal.fire('錯誤', '「姓名」與「候選資格」為必填欄位', 'error');
        return;
    }

    const result = await Swal.fire({
        title: '新增候選人',
        text: "【注意】新增後，系統將自動把此人同步加入到符合資格且尚未開始的輪次中。確定要新增嗎？",
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: '確定新增',
        cancelButtonText: '取消'
    });
    if (!result.isConfirmed) return;

    try {
        const btn = document.getElementById('saveCandidateBtn');
        btn.disabled = true;
        btn.textContent = '儲存中...';

        const { collection, addDoc, serverTimestamp } = window.fs;
        const db = window.firebaseDb;
        const candidatesRef = collection(db, 'elections', currentElectionId, 'candidates');

        await addDoc(candidatesRef, {
            number: number,
            name: name,
            district: district,
            unit: unit,
            qualification: qualification,
            createdAt: serverTimestamp()
        });

        Swal.fire('成功', '新增候選人成功！', 'success');
        bootstrap.Modal.getInstance(document.getElementById('addCandidateModal')).hide();
        document.getElementById('addCandidateForm').reset();
        await loadCandidates();

    } catch (error) {
        console.error("單筆新增失敗:", error);
        Swal.fire('錯誤', '新增失敗: ' + error.message, 'error');
    } finally {
        const btn = document.getElementById('saveCandidateBtn');
        btn.disabled = false;
        btn.textContent = '儲存候選人';
    }
});

// 打開編輯候選人 Modal
window.openEditCandidate = function(id) {
    const c = allCandidates.find(cand => cand.id === id);
    if (!c) return;

    document.getElementById('editCandIdInput').value = c.id;
    document.getElementById('editCandNumberInput').value = c.number || '';
    document.getElementById('editCandNameInput').value = c.name || '';
    document.getElementById('editCandDistrictInput').value = c.district || '';
    document.getElementById('editCandUnitInput').value = c.unit || '';
    document.getElementById('editCandQualInput').value = c.qualification || '';
    document.getElementById('editCandElectedItemInput').value = c.elected_item || '';
    document.getElementById('editCandIneligibleInput').checked = !!c.is_ineligible;

    const modal = new bootstrap.Modal(document.getElementById('editCandidateModal'));
    modal.show();
}

// 儲存編輯變更
document.getElementById('updateCandidateBtn').addEventListener('click', async () => {
    const id = document.getElementById('editCandIdInput').value;
    const name = document.getElementById('editCandNameInput').value.trim();
    if (!name) {
        Swal.fire('錯誤', '「姓名」為必填欄位', 'error');
        return;
    }

    const result = await Swal.fire({
        title: '儲存變更',
        text: "【注意】變更候選人資料或資格後，系統會自動重新計算並覆蓋所有未開始的輪次名單！確定要儲存嗎？",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '確定儲存',
        cancelButtonText: '取消'
    });
    if (!result.isConfirmed) return;

    try {
        const isIneligible = document.getElementById('editCandIneligibleInput').checked;
        
        // 檢查是否為保障名額，若是則不允許設為不可被選
        if (isIneligible && allItems && allItems.length > 0) {
            for (const item of allItems) {
                if (item.forced_candidate_id === id) {
                    Swal.fire('錯誤', `此候選人已被設定為【${item.title}】的保障名額，無法將其設為不可被選！若要修改，請先至該項次移除保障設定。`, 'error');
                    return;
                }
            }
        }

        const btn = document.getElementById('updateCandidateBtn');
        btn.disabled = true;
        btn.textContent = '儲存中...';

        const { doc, updateDoc } = window.fs;
        const db = window.firebaseDb;
        const candRef = doc(db, 'elections', currentElectionId, 'candidates', id);

        await updateDoc(candRef, {
            number: document.getElementById('editCandNumberInput').value.trim(),
            name: name,
            district: document.getElementById('editCandDistrictInput').value.trim(),
            unit: document.getElementById('editCandUnitInput').value.trim(),
            qualification: document.getElementById('editCandQualInput').value.trim(),
            // elected_item 保持唯讀不給更新
            is_ineligible: isIneligible
        });

        Swal.fire('成功', '更新候選人資料成功！', 'success');
        bootstrap.Modal.getInstance(document.getElementById('editCandidateModal')).hide();
        await loadCandidates();

    } catch (error) {
        console.error("編輯失敗:", error);
        Swal.fire('錯誤', '更新失敗: ' + error.message, 'error');
    } finally {
        const btn = document.getElementById('updateCandidateBtn');
        btn.disabled = false;
        btn.textContent = '儲存變更';
    }
});

// ==========================================
// 項次與輪次設定 (Items & Rounds)
// ==========================================

async function loadItems() {
    const { collection, getDocs, doc } = window.fs;
    const db = window.firebaseDb;
    const itemsRef = collection(db, 'elections', currentElectionId, 'items');
    const snap = await getDocs(itemsRef);
    
    allItems = [];
    
    for (const d of snap.docs) {
        let itemData = { id: d.id, ...d.data(), rounds: [] };
        
        // 讀取底下的三輪資料
        const roundsRef = collection(db, 'elections', currentElectionId, 'items', d.id, 'rounds');
        const rSnap = await getDocs(roundsRef);
        rSnap.forEach(r => {
            itemData.rounds.push({ id: r.id, ...r.data() });
        });
        
        // 排序 rounds (round_1, round_2, round_3)
        itemData.rounds.sort((a, b) => a.id.localeCompare(b.id));
        
        allItems.push(itemData);
    }
    
    allItems.sort((a, b) => {
        const tA = a.createdAt ? a.createdAt.toMillis() : 0;
        const tB = b.createdAt ? b.createdAt.toMillis() : 0;
        return tA - tB;
    });

    document.getElementById('statItems').textContent = allItems.length;
    renderItemsAccordion();
    checkElectionLockState(); // 檢查是否需要鎖定 Excel 匯入
}

// 檢查全域鎖定狀態
let isElectionLocked = false;
function checkElectionLockState() {
    isElectionLocked = false;
    for (const item of allItems) {
        for (const round of item.rounds) {
            if (round.status === 'ACTIVE' || round.status === 'CLOSED') {
                isElectionLocked = true;
                break;
            }
        }
        if (isElectionLocked) break;
    }

    const excelBtn = document.getElementById('excelUpload').previousElementSibling; // 按鈕本身
    const deleteBtns = document.querySelectorAll('.delete-cand-btn');
    
    if (isElectionLocked) {
        excelBtn.disabled = true;
        excelBtn.title = '選舉已開始，禁止批次匯入以免破壞資料結構';
        deleteBtns.forEach(btn => btn.disabled = true);
        
        // 加上提示橫幅
        let banner = document.getElementById('lockedBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'lockedBanner';
            banner.className = 'alert alert-danger py-2 mb-3';
            banner.innerHTML = '<i class="fas fa-lock"></i> <strong>鎖定中：</strong> 因為已有選舉輪次開始，為保護資料完整性，系統已停用「Excel 匯入」與「刪除候選人」功能。';
            const candidateCard = document.querySelector('#section-candidates .card');
            candidateCard.insertBefore(banner, candidateCard.children[1]);
        }
    }
}

function renderItemsAccordion() {
    const container = document.getElementById('itemsAccordion');
    container.innerHTML = '';
    
    if (allItems.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-4">尚無選舉項次，請點擊右上方新增。</p>';
        return;
    }

    allItems.forEach((item, index) => {
        const isFirst = index === 0;
        
        // 生成資格與分區 Badge
        let badgesHtml = '';
        if (item.require_district) {
            badgesHtml += `<span class="badge bg-danger ms-2"><i class="fas fa-map-marker-alt"></i> 強制分區</span>`;
        }
        if (item.qualifications) {
            badgesHtml += `<span class="badge bg-info ms-2">限: ${item.qualifications}</span>`;
        }
        
        // 生成輪次清單 HTML
        let roundsHtml = '';
        item.rounds.forEach(round => {
            const statusColor = round.status === 'PENDING' ? 'secondary' : (round.status === 'ACTIVE' ? 'success' : 'dark');
            const statusText = round.status === 'PENDING' ? '未開始' : (round.status === 'ACTIVE' ? '投票中' : '已結束');
            
            const displaySeats = round.seats !== undefined ? round.seats : item.seats;
            
            roundsHtml += `
                <div class="d-flex justify-content-between align-items-center border-bottom py-2">
                    <div>
                        <strong>${getRoundName(round.id)}</strong> <small class="text-muted ms-1">(本輪應選 ${displaySeats} 席)</small>
                        <span class="badge bg-${statusColor} ms-2">${statusText}</span>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-outline-warning" onclick="openEditRoundModal('${item.id}', '${round.id}')"><i class="fas fa-edit"></i> 修改參數</button>
                        <button class="btn btn-sm btn-outline-secondary ms-1" onclick="openKeyManagement('${item.id}', '${round.id}')"><i class="fas fa-key"></i> 金鑰</button>
                        <button class="btn btn-sm btn-outline-primary ms-1" onclick="openRoundCandidates('${item.id}', '${round.id}')">調整名單 (${round.candidate_ids ? round.candidate_ids.length : 0}人在候選區)</button>
                        <button class="btn btn-sm btn-success ms-1" onclick="startRound('${item.id}', '${round.id}')" ${round.status !== 'PENDING' ? 'disabled' : ''}>開始投票</button>
                        <button class="btn btn-sm btn-info text-white ms-1" onclick="openTallyCenter('${item.id}', '${round.id}')" style="display: ${round.status !== 'PENDING' ? 'inline-block' : 'none'};">開票中心</button>
                    </div>
                </div>
            `;
        });

        container.innerHTML += `
            <div class="accordion-item">
                <h2 class="accordion-header" id="heading_${item.id}">
                    <button class="accordion-button ${isFirst ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse_${item.id}">
                        <strong>${item.title}</strong> (應選 ${item.seats} 名)
                        ${badgesHtml}
                    </button>
                </h2>
                <div id="collapse_${item.id}" class="accordion-collapse collapse ${isFirst ? 'show' : ''}" data-bs-parent="#itemsAccordion">
                    <div class="accordion-body">
                        ${roundsHtml}
                        <div class="mt-3 text-end">
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteItem('${item.id}')"><i class="fas fa-trash"></i> 刪除此項次</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    // 觸發更新 Keys 和 Tally 的下拉選單
    updateKeysAndTallySelects();
}

function updateKeysAndTallySelects() {
    const keysItemSelect = document.getElementById('keysItemSelect');
    const tallyItemSelect = document.getElementById('tallyItemSelect');
    
    if (!keysItemSelect || !tallyItemSelect) return;

    // 清空並重新加入選項
    keysItemSelect.innerHTML = '<option value="">請選擇...</option>';
    tallyItemSelect.innerHTML = '<option value="">請選擇...</option>';

    allItems.forEach(item => {
        keysItemSelect.innerHTML += `<option value="${item.id}">${item.title}</option>`;
        tallyItemSelect.innerHTML += `<option value="${item.id}">${item.title}</option>`;
    });
}

// 監聽 keys 和 tally 下拉選單變化，自動觸發載入
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnLoadKeys')?.addEventListener('click', () => {
        const itemId = document.getElementById('keysItemSelect').value;
        const roundId = document.getElementById('keysRoundSelect').value;
        if (itemId && roundId) {
            document.getElementById('keysContentContainer').style.display = 'block';
            document.getElementById('manageKeysItemId').value = itemId;
            document.getElementById('manageKeysRoundId').value = roundId;
            loadKeys(itemId, roundId);
        } else {
            Swal.fire('提示', '請先選擇項次與輪次', 'info');
        }
    });

    document.getElementById('btnLoadTally')?.addEventListener('click', async () => {
        const itemId = document.getElementById('tallyItemSelect').value;
        const roundId = document.getElementById('tallyRoundSelect').value;
        if (itemId && roundId) {
            // 透過模擬點擊或直接呼叫開啟邏輯 (為了更新 UI 狀態)
            const item = allItems.find(i => i.id === itemId);
            const round = item?.rounds.find(r => r.id === roundId);
            
            if (item && round) {
                // 設定狀態等 UI 元素
                document.getElementById('tallyTitle').textContent = `${item.title} - ${getRoundName(round.id)}`;
                document.getElementById('tallyItemId').value = itemId;
                document.getElementById('tallyRoundId').value = roundId;
                const effectiveSeats = round.seats !== undefined ? round.seats : item.seats;
                document.getElementById('tallyQuota').textContent = effectiveSeats || 0;

                const badge = document.getElementById('tallyStatusBadge');
                const btnEnd = document.getElementById('btnEndVoting');
                const btnReopen = document.getElementById('btnReopenVoting');
                const btnPublish = document.getElementById('btnPublishTally');

                if (round.status === 'ACTIVE') {
                    badge.textContent = '狀態：投票進行中';
                    badge.className = 'badge bg-success fs-6';
                    btnEnd.style.display = 'inline-block';
                    btnReopen.style.display = 'none';
                    btnPublish.disabled = true;
                } else if (round.status === 'CLOSED') {
                    badge.textContent = '狀態：開票結算中';
                    badge.className = 'badge bg-warning text-dark fs-6';
                    btnEnd.style.display = 'none';
                    btnReopen.style.display = 'inline-block';
                    btnPublish.disabled = false;
                } else {
                    badge.textContent = '狀態：結果已發布';
                    badge.className = 'badge bg-secondary fs-6';
                    btnEnd.style.display = 'none';
                    btnReopen.style.display = 'none';
                    btnPublish.disabled = true;
                }

                document.getElementById('tallyQuorumBase').value = round.quorum_base || currentElectionData.quorum_base || 'ATTENDING';
                document.getElementById('tallyAttendingCount').value = round.attending_count || currentElectionData.init_attending_count || 0;
                document.getElementById('tallyPaperIssued').value = round.paper_issued || 0;

                document.getElementById('tallyContentContainer').style.display = 'block';

                currentTallyData.itemId = itemId;
                currentTallyData.roundId = roundId;
                currentTallyData.candidates = [];
                currentTallyData.digitalVotesMap = {};

                await loadTallyStats(itemId, roundId);
                
                const candidateIds = round.candidate_ids || [];
                currentTallyData.candidates = allCandidates.filter(c => candidateIds.includes(c.id)).map(c => {
                    const digi = currentTallyData.digitalVotesMap[c.id] || 0;
                    const paper = (round.paper_votes && round.paper_votes[c.id]) ? parseInt(round.paper_votes[c.id]) : 0;
                    const isElected = round.elected_ids ? round.elected_ids.includes(c.id) : false;
                    return {
                        ...c,
                        digital_votes: digi,
                        paper_votes: paper,
                        total_votes: digi + paper,
                        is_elected: isElected
                    };
                });

                updateTallyThreshold();
                renderTallyTable();
            } else {
                Swal.fire('錯誤', '找不到對應的項次或輪次資料', 'error');
            }
        } else {
            Swal.fire('提示', '請先選擇項次與輪次', 'info');
        }
    });
});

function getRoundName(roundId) {
    if (roundId === 'round_1') return '第一輪';
    if (roundId === 'round_2') return '第二輪';
    if (roundId === 'round_3') return '第三輪';
    return roundId;
}

// 動態顯示分區勾選清單
document.getElementById('itemDistrictReqInput').addEventListener('change', function(e) {
    const container = document.getElementById('districtCheckboxesContainer');
    if (e.target.checked) {
        // 抓取不重複的分區
        let districts = [...new Set(allCandidates.filter(c => c.district).map(c => c.district))];
        const listDiv = document.getElementById('districtCheckboxesList');
        listDiv.innerHTML = '';
        
        if (districts.length === 0) {
            listDiv.innerHTML = '<p class="text-danger mb-0">警告：目前的候選人資料庫中，沒有任何分區資料，無法使用強制分區競選！</p>';
        } else {
            districts.forEach((d, idx) => {
                listDiv.innerHTML += `
                    <div class="col-md-4 mb-2">
                        <div class="form-check">
                            <input class="form-check-input district-checkbox" type="checkbox" value="${d}" id="dist_${idx}">
                            <label class="form-check-label" for="dist_${idx}">${d}</label>
                        </div>
                    </div>
                `;
            });
        }
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
    }
});

// 更新 Modal 內的動態選項清單 (動態資格、強制候選下拉)
function updateDynamicFormOptions() {
    // 1. 動態資格核取方塊
    const qualContainer = document.getElementById('qualCheckboxesContainer');
    let qualifications = [...new Set(allCandidates.filter(c => c.qualification).map(c => c.qualification))];
    
    qualContainer.innerHTML = '';
    if (qualifications.length === 0) {
        qualContainer.innerHTML = '<p class="text-danger mb-0">無任何資格資料可選</p>';
    } else {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'row';
        qualifications.forEach((q, idx) => {
            rowDiv.innerHTML += `
                <div class="col-md-6 mb-2">
                    <div class="form-check">
                        <input class="form-check-input qual-checkbox" type="checkbox" value="${q}" id="qual_${idx}">
                        <label class="form-check-label" for="qual_${idx}">${q}</label>
                    </div>
                </div>
            `;
        });
        qualContainer.appendChild(rowDiv);
    }

    // 2. 強制候選人下拉選單
    const forcedSelect = document.getElementById('itemForcedCandidateSelect');
    forcedSelect.innerHTML = '<option value="">請選擇保留的候選人...</option>';
    
    // 只列出正常(非不可被選)的候選人
    const eligibleCands = allCandidates.filter(c => !c.is_ineligible);
    eligibleCands.forEach(c => {
        const distText = c.district ? ` - ${c.district}` : '';
        forcedSelect.innerHTML += `<option value="${c.id}">${c.number} ${c.name}${distText}</option>`;
    });
}

// 顯示/隱藏強制候選人選單
document.getElementById('itemForcedCandidateInput').addEventListener('change', function(e) {
    document.getElementById('forcedCandidateSelectContainer').style.display = e.target.checked ? 'block' : 'none';
});

// 儲存項次與初始化三輪
document.getElementById('saveItemBtn').addEventListener('click', async () => {
    const title = document.getElementById('itemTitleInput').value.trim();
    const seats = parseInt(document.getElementById('itemSeatsInput').value);
    
    // 讀取動態勾選的資格
    const qCheckboxes = document.querySelectorAll('.qual-checkbox:checked');
    const qArray = Array.from(qCheckboxes).map(cb => cb.value);

    const reqDistrict = document.getElementById('itemDistrictReqInput').checked;
    const excludeElected = document.getElementById('itemExcludeElectedInput').checked;
    
    // 強制候選
    const isForced = document.getElementById('itemForcedCandidateInput').checked;
    let forcedCandidateId = null;
    if (isForced) {
        forcedCandidateId = document.getElementById('itemForcedCandidateSelect').value;
        if (!forcedCandidateId) {
            Swal.fire('錯誤', '您已開啟強制候選機制，請指定一位候選人！', 'error');
            return;
        }
    }
    
    if (!title || isNaN(seats) || seats < 1) {
        Swal.fire('錯誤', '請填寫完整項次名稱與應選名額', 'error');
        return;
    }

    // 檢查分區勾選數量
    let selectedDistricts = [];
    if (reqDistrict) {
        const checkboxes = document.querySelectorAll('.district-checkbox:checked');
        checkboxes.forEach(cb => selectedDistricts.push(cb.value));
        
        let requiredDistrictsCount = isForced ? seats - 1 : seats;
        if (requiredDistrictsCount < 0) requiredDistrictsCount = 0; // 防呆
        
        if (selectedDistricts.length !== requiredDistrictsCount) {
            Swal.fire('錯誤', `此項次應選 ${seats} 名，${isForced ? '扣除保障名額 1 名後，' : ''}您必須精準勾選 ${requiredDistrictsCount} 個不同的地區！\n目前已勾選：${selectedDistricts.length} 個。`, 'error');
            return;
        }
    }

    try {
        const btn = document.getElementById('saveItemBtn');
        btn.disabled = true;
        btn.textContent = '建立中...';

        const { collection, addDoc, doc, setDoc, serverTimestamp } = window.fs;
        const db = window.firebaseDb;

        // 1. 建立 Item
        const itemsRef = collection(db, 'elections', currentElectionId, 'items');
        const newItemRef = await addDoc(itemsRef, {
            title: title,
            seats: seats,
            qualifications: qArray, // 改存陣列
            require_district: reqDistrict,
            selected_districts: selectedDistricts,
            exclude_elected: excludeElected,
            forced_candidate_id: forcedCandidateId, // 寫入強制候選人 ID
            createdAt: serverTimestamp()
        });

        // 核心過濾邏輯 (為第一輪產生預設名單)
        let initialCandidateIds = allCandidates.filter(c => {
            // (1) 全域不可被選：直接剔除
            if (c.is_ineligible) return false;
            
            // (2) 排除已當選者：若開啟，且有當選項次紀錄，則剔除
            if (excludeElected && c.elected_item && c.elected_item.trim() !== '') return false;
            
            // (3) 候選資格限制：若有設定，必須符合其中之一
            if (qArray.length > 0 && !qArray.includes(c.qualification)) return false;
            
            return true;
        }).map(c => c.id);

        // 如果有強制候選人，且他因為某些過濾條件被剔除了，要強硬把他加回來
        if (forcedCandidateId && !initialCandidateIds.includes(forcedCandidateId)) {
            initialCandidateIds.push(forcedCandidateId);
        }

        // 3. 建立三輪 (round_1, round_2, round_3)
        const round1Ref = doc(db, 'elections', currentElectionId, 'items', newItemRef.id, 'rounds', 'round_1');
        const round2Ref = doc(db, 'elections', currentElectionId, 'items', newItemRef.id, 'rounds', 'round_2');
        const round3Ref = doc(db, 'elections', currentElectionId, 'items', newItemRef.id, 'rounds', 'round_3');

        await setDoc(round1Ref, { status: 'PENDING', candidate_ids: initialCandidateIds });
        await setDoc(round2Ref, { status: 'PENDING', candidate_ids: initialCandidateIds });
        await setDoc(round3Ref, { status: 'PENDING', candidate_ids: initialCandidateIds });

        Swal.fire('成功', '已建立項次並初始化三輪', 'success');
        bootstrap.Modal.getInstance(document.getElementById('addItemModal')).hide();
        document.getElementById('addItemForm').reset();
        
        await loadItems();

    } catch (error) {
        console.error("建立項次失敗:", error);
        Swal.fire('錯誤', error.message, 'error');
    } finally {
        const btn = document.getElementById('saveItemBtn');
        btn.disabled = false;
        btn.textContent = '建立項次與三輪設定';
    }
});

window.deleteItem = async function(itemId) {
    Swal.fire({
        title: '確定要刪除此項次嗎？',
        text: '刪除後，該項次底下所有的輪次設定將一併被刪除。',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6c757d',
        confirmButtonText: '確定刪除',
        cancelButtonText: '取消'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const { doc, writeBatch } = window.fs;
                const db = window.firebaseDb;
                const batch = writeBatch(db);
                
                // 刪除子集合 rounds
                batch.delete(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', 'round_1'));
                batch.delete(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', 'round_2'));
                batch.delete(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', 'round_3'));
                
                // 刪除 item 本身
                batch.delete(doc(db, 'elections', currentElectionId, 'items', itemId));
                
                await batch.commit();

                Swal.fire('已刪除', '該項次已成功刪除。', 'success');
                await loadItems();
            } catch (error) {
                console.error("刪除失敗:", error);
                Swal.fire('錯誤', '刪除失敗: ' + error.message, 'error');
            }
        }
    });
}

window.startRound = function(itemId, roundId) {
    if (checkAnyActiveRound(itemId, roundId)) return;

    Swal.fire({
        title: '確定要啟動此輪投票嗎？',
        text: '啟動後，將無法再調整名單。',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#28a745',
        confirmButtonText: '確定啟動'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const { doc, setDoc } = window.fs;
                const db = window.firebaseDb;

                const item = allItems.find(i => i.id === itemId);
                if (!item) return;

                // 正確更新子集合中的 round 文件
                await setDoc(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', roundId), {
                    status: 'ACTIVE',
                    updatedAt: window.fs.serverTimestamp()
                }, { merge: true });

                Swal.fire({
                    title: '成功',
                    text: '投票已正式啟動！即將進入開票中心...',
                    icon: 'success',
                    timer: 1500,
                    showConfirmButton: false
                }).then(async () => {
                    await loadItems();
                    openTallyCenter(itemId, roundId);
                });
            } catch (error) {
                console.error("啟動失敗:", error);
                Swal.fire('錯誤', error.message, 'error');
            }
        }
    });
}

// ==========================================
// 選票預覽 (Ballot Preview)
// ==========================================

function updatePreviewSelects() {
    const itemSelect = document.getElementById('previewItemSelect');
    itemSelect.innerHTML = '<option value="">請選擇項次...</option>';
    
    allItems.forEach(item => {
        itemSelect.innerHTML += `<option value="${item.id}">${item.title}</option>`;
    });
}

document.getElementById('btnGeneratePreview').addEventListener('click', () => {
    const itemId = document.getElementById('previewItemSelect').value;
    const roundId = document.getElementById('previewRoundSelect').value;
    
    if (!itemId || !roundId) {
        Swal.fire('提示', '請先選擇項次與輪次', 'warning');
        return;
    }
    
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    
    const round = item.rounds.find(r => r.id === roundId);
    if (!round) return;

    // 渲染資料
    document.getElementById('previewOrgName').textContent = currentOrgData ? currentOrgData.name : '未知機構';
    document.getElementById('previewElectionName').textContent = currentElectionData.name;
    document.getElementById('previewItemRoundName').textContent = `${item.title} - ${getRoundName(round.id)}`;

    // 處理浮水印
    const watermark = document.getElementById('ballotSealWatermark');
    if (currentOrgData && currentOrgData.seal_url) {
        watermark.src = currentOrgData.seal_url;
        watermark.style.display = 'block';
    } else {
        watermark.style.display = 'none';
    }

    document.getElementById('ballotPreviewContainer').style.display = 'block';
});

// ==========================================
// 輪次微調名單 (Shuttle Box 雙欄穿梭)
// ==========================================
window.openEditRoundModal = function(itemId, roundId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    const round = item.rounds.find(r => r.id === roundId);
    if (!round) return;

    if (round.status !== 'PENDING') {
        Swal.fire('系統鎖定', '該輪次已開始或已結束，無法再修改參數！', 'warning');
        return;
    }

    document.getElementById('editRoundItemId').value = itemId;
    document.getElementById('editRoundRoundId').value = roundId;
    document.getElementById('editRoundTitleDisplay').textContent = `${item.title} - ${getRoundName(round.id)}`;

    // 載入參數 (若輪次無設定，讀取項次預設值)
    const effectiveSeats = round.seats !== undefined ? round.seats : item.seats;
    document.getElementById('editRoundSeatsInput').value = effectiveSeats;
    
    const effectiveQuals = round.qualifications !== undefined ? round.qualifications : (item.qualifications || []);
    
    // 渲染資格勾選框 (Edit Round)
    const container = document.getElementById('editRoundQualCheckboxesContainer');
    container.innerHTML = '';
    const uniqueQuals = [...new Set(allCandidates.map(c => c.qualification).filter(Boolean))];
    if (uniqueQuals.length === 0) {
        container.innerHTML = '<small class="text-muted">目前沒有可用的候選資格分類。</small>';
    } else {
        uniqueQuals.forEach((q, idx) => {
            const isChecked = effectiveQuals.includes(q) ? 'checked' : '';
            container.innerHTML += `
                <div class="form-check form-check-inline">
                    <input class="form-check-input edit-round-qual-checkbox" type="checkbox" id="edit_round_qual_${idx}" value="${q}" ${isChecked}>
                    <label class="form-check-label" for="edit_round_qual_${idx}">${q}</label>
                </div>
            `;
        });
    }

    const effectiveForcedId = round.forced_candidate_id !== undefined ? round.forced_candidate_id : item.forced_candidate_id;
    const forcedInput = document.getElementById('editRoundForcedCandidateInput');
    const forcedSelectContainer = document.getElementById('editRoundForcedCandidateSelectContainer');
    const forcedSelect = document.getElementById('editRoundForcedCandidateSelect');
    
    forcedSelect.innerHTML = '<option value="">請選擇保留的候選人...</option>';
    const eligibleCands = allCandidates.filter(c => !c.is_ineligible);
    eligibleCands.forEach(c => {
        const distText = c.district ? ` - ${c.district}` : '';
        forcedSelect.innerHTML += `<option value="${c.id}">${c.number} ${c.name}${distText}</option>`;
    });

    if (effectiveForcedId) {
        forcedInput.checked = true;
        forcedSelectContainer.style.display = 'block';
        forcedSelect.value = effectiveForcedId;
    } else {
        forcedInput.checked = false;
        forcedSelectContainer.style.display = 'none';
        forcedSelect.value = '';
    }

    const effectiveExclude = round.exclude_elected !== undefined ? round.exclude_elected : (item.exclude_elected !== false);
    document.getElementById('editRoundExcludeElectedInput').checked = effectiveExclude;

    const effectiveReqDist = round.require_district !== undefined ? round.require_district : item.require_district;
    const distReqInput = document.getElementById('editRoundDistrictReqInput');
    const distContainer = document.getElementById('editRoundDistrictCheckboxesContainer');
    const distList = document.getElementById('editRoundDistrictCheckboxesList');
    
    const effectiveSelectedDistricts = round.selected_districts !== undefined ? round.selected_districts : (item.selected_districts || []);

    if (effectiveReqDist) {
        distReqInput.checked = true;
        distContainer.style.display = 'block';
    } else {
        distReqInput.checked = false;
        distContainer.style.display = 'none';
    }

    distList.innerHTML = '';
    const uniqueDists = [...new Set(allCandidates.map(c => c.district).filter(Boolean))];
    uniqueDists.forEach((d, idx) => {
        const isChecked = effectiveSelectedDistricts.includes(d) ? 'checked' : '';
        distList.innerHTML += `
            <div class="col-md-4 mb-2">
                <div class="form-check">
                    <input class="form-check-input edit-round-district-checkbox" type="checkbox" value="${d}" id="edit_round_dist_${idx}" ${isChecked}>
                    <label class="form-check-label" for="edit_round_dist_${idx}">${d}</label>
                </div>
            </div>
        `;
    });

    const modal = new bootstrap.Modal(document.getElementById('editRoundModal'));
    modal.show();
};

document.addEventListener('DOMContentLoaded', () => {
    // 顯示/隱藏強制候選人選單 (Edit Round)
    document.getElementById('editRoundForcedCandidateInput')?.addEventListener('change', function(e) {
        document.getElementById('editRoundForcedCandidateSelectContainer').style.display = e.target.checked ? 'block' : 'none';
    });

    // 動態顯示分區勾選清單 (Edit Round)
    document.getElementById('editRoundDistrictReqInput')?.addEventListener('change', function(e) {
        document.getElementById('editRoundDistrictCheckboxesContainer').style.display = e.target.checked ? 'block' : 'none';
    });

    // 儲存修改輪次參數
    document.getElementById('saveEditRoundBtn')?.addEventListener('click', async () => {
        const itemId = document.getElementById('editRoundItemId').value;
        const roundId = document.getElementById('editRoundRoundId').value;
        const seats = parseInt(document.getElementById('editRoundSeatsInput').value);
        
        if (isNaN(seats) || seats < 1) {
            Swal.fire('錯誤', '應選名額必須大於 0', 'error');
            return;
        }

        const qCheckboxes = document.querySelectorAll('.edit-round-qual-checkbox:checked');
        const qArray = Array.from(qCheckboxes).map(cb => cb.value);

        const reqDistrict = document.getElementById('editRoundDistrictReqInput').checked;
        const excludeElected = document.getElementById('editRoundExcludeElectedInput').checked;
        
        const isForced = document.getElementById('editRoundForcedCandidateInput').checked;
        let forcedCandidateId = null;
        if (isForced) {
            forcedCandidateId = document.getElementById('editRoundForcedCandidateSelect').value;
            if (!forcedCandidateId) {
                Swal.fire('錯誤', '您已開啟強制候選機制，請指定一位候選人！', 'error');
                return;
            }
        }

        let selectedDistricts = [];
        if (reqDistrict) {
            const checkboxes = document.querySelectorAll('.edit-round-district-checkbox:checked');
            checkboxes.forEach(cb => selectedDistricts.push(cb.value));
            
            let requiredDistrictsCount = isForced ? seats - 1 : seats;
            if (requiredDistrictsCount < 0) requiredDistrictsCount = 0;
            
            if (selectedDistricts.length !== requiredDistrictsCount) {
                Swal.fire('錯誤', `此輪應選 ${seats} 席，${isForced ? '扣除保障名額 1 名後，' : ''}您必須精準勾選 ${requiredDistrictsCount} 個不同的地區！\n目前已勾選：${selectedDistricts.length} 個。`, 'error');
                return;
            }
        }

        try {
            const btn = document.getElementById('saveEditRoundBtn');
            btn.disabled = true;
            btn.textContent = '儲存中...';

            const { doc, updateDoc, serverTimestamp } = window.fs;
            const db = window.firebaseDb;

            const roundRef = doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', roundId);
            await updateDoc(roundRef, {
                seats: seats,
                qualifications: qArray,
                require_district: reqDistrict,
                selected_districts: selectedDistricts,
                exclude_elected: excludeElected,
                forced_candidate_id: forcedCandidateId,
                updatedAt: serverTimestamp()
            });

            Swal.fire('成功', '輪次專屬設定已更新！', 'success');
            bootstrap.Modal.getInstance(document.getElementById('editRoundModal')).hide();
            await loadItems();

        } catch (error) {
            console.error("更新輪次參數失敗:", error);
            Swal.fire('錯誤', error.message, 'error');
        } finally {
            const btn = document.getElementById('saveEditRoundBtn');
            if(btn) {
                btn.disabled = false;
                btn.textContent = '儲存輪次專屬設定';
            }
        }
    });
});

// ==========================================
window.openRoundCandidates = function(itemId, roundId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    const round = item.rounds.find(r => r.id === roundId);
    if (!round) return;

    // 檢查全域選舉是否鎖定，或者該輪次是否鎖定
    const globalStatus = currentElectionData.status || 'PENDING';
    if (globalStatus !== 'PENDING' && round.status !== 'PENDING') {
        Swal.fire('系統鎖定', '該輪次已開始或已結束，無法再微調名單！', 'warning');
        return;
    }

    const effectiveSeats = round.seats !== undefined ? round.seats : item.seats;
    document.getElementById('adjustRoundTitle').textContent = `${item.title} - ${getRoundName(round.id)} (應選 ${effectiveSeats} 席)`;
    document.getElementById('adjustItemId').value = itemId;
    document.getElementById('adjustRoundId').value = roundId;

    const selectedIds = round.candidate_ids || [];
    const forceId = round.forced_candidate_id !== undefined ? round.forced_candidate_id : item.forced_candidate_id;
    const effectiveQuals = round.qualifications !== undefined ? round.qualifications : item.qualifications;
    const effectiveExclude = round.exclude_elected !== undefined ? round.exclude_elected : item.exclude_elected;
    
    // 清空並重建清單
    const listSelected = document.getElementById('listSelected');
    const listUnselected = document.getElementById('listUnselected');
    listSelected.innerHTML = '';
    listUnselected.innerHTML = '';

    // 解析允許資格 (若有)
    let allowedQuals = [];
    if (effectiveQuals) {
        if (Array.isArray(effectiveQuals)) {
            allowedQuals = effectiveQuals;
        } else if (typeof effectiveQuals === 'string') {
            allowedQuals = effectiveQuals.split(',').map(s => s.trim()).filter(Boolean);
        }
    }

    allCandidates.forEach(c => {
        // 基本過濾：如果沒有包含資格，就不顯示
        if (allowedQuals.length > 0 && c.qualification && !allowedQuals.includes(c.qualification)) {
            return;
        }

        // 判斷狀態
        let isSelected = selectedIds.includes(c.id);
        let isDisabled = false;
        let badgeHtml = '';

        if (c.is_ineligible) {
            isSelected = false;
            isDisabled = true;
            badgeHtml = '<span class="badge bg-danger float-end">不可被選</span>';
        } else if (c.id === forceId) {
            isSelected = true;
            isDisabled = true;
            badgeHtml = '<span class="badge bg-warning text-dark float-end">保障名額</span>';
        } else if (c.elected_item && effectiveExclude) {
            // 如果設定排除已當選者，且該人已經有當選頭銜
            isSelected = false;
            isDisabled = true;
            badgeHtml = `<span class="badge bg-secondary float-end">已當選: ${c.elected_item}</span>`;
        }

        const li = document.createElement('li');
        // 加入 list-group-item-danger class 讓非候選區有紅色背景以示區別，但不可被選(disabled)的保持預設灰色
        const itemClass = isDisabled ? 'disabled' : (isSelected ? '' : 'list-group-item-danger');
        li.className = `list-group-item d-flex justify-content-between align-items-center ${itemClass}`;
        li.dataset.id = c.id;
        li.innerHTML = `
            <div>
                <span class="text-primary me-2 fw-bold">${c.number || ''}</span>
                <span>${c.name}</span>
                ${c.district ? `<small class="text-muted ms-2">[${c.district}]</small>` : ''}
            </div>
            ${badgeHtml}
        `;

        if (!isDisabled) {
            li.addEventListener('click', function() {
                this.classList.toggle('active');
            });
        }

        if (isSelected) {
            listSelected.appendChild(li);
        } else {
            listUnselected.appendChild(li);
        }
    });

    updateShuttleCounts();
    document.getElementById('searchSelected').value = '';
    document.getElementById('searchUnselected').value = '';
    
    const modal = new bootstrap.Modal(document.getElementById('adjustRoundCandidatesModal'));
    modal.show();
};

function updateShuttleCounts() {
    // 只計算沒有被 display: none 的數量 (雖然搜尋時會隱藏，但計數應為全量，這裡計算所有 DOM element)
    document.getElementById('countSelected').textContent = document.querySelectorAll('#listSelected .list-group-item').length;
    document.getElementById('countUnselected').textContent = document.querySelectorAll('#listUnselected .list-group-item').length;
}

// 穿梭框按鈕綁定
document.addEventListener('DOMContentLoaded', () => {
    // 搜尋功能
    const setupSearch = (inputId, listId) => {
        document.getElementById(inputId)?.addEventListener('input', function(e) {
            const term = e.target.value.toLowerCase();
            document.querySelectorAll(`#${listId} .list-group-item`).forEach(li => {
                const text = li.textContent.toLowerCase();
                if (text.includes(term)) {
                    li.classList.remove('d-none');
                } else {
                    li.classList.add('d-none');
                }
            });
        });
    };
    setupSearch('searchSelected', 'listSelected');
    setupSearch('searchUnselected', 'listUnselected');

    // 移出所選 (左到右)
    document.getElementById('btnMoveToRight')?.addEventListener('click', () => {
        const selected = document.querySelectorAll('#listSelected .list-group-item.active:not(.disabled)');
        const targetList = document.getElementById('listUnselected');
        selected.forEach(li => {
            li.classList.remove('active');
            li.classList.add('list-group-item-danger'); // 移出時加上紅色標示
            targetList.appendChild(li);
        });
        updateShuttleCounts();
    });

    // 全部移出 (左到右)
    document.getElementById('btnMoveAllToRight')?.addEventListener('click', () => {
        const all = document.querySelectorAll('#listSelected .list-group-item:not(.disabled)');
        const targetList = document.getElementById('listUnselected');
        all.forEach(li => {
            li.classList.remove('active');
            li.classList.add('list-group-item-danger'); // 移出時加上紅色標示
            targetList.appendChild(li);
        });
        updateShuttleCounts();
    });

    // 移入所選 (右到左)
    document.getElementById('btnMoveToLeft')?.addEventListener('click', () => {
        const selected = document.querySelectorAll('#listUnselected .list-group-item.active:not(.disabled)');
        const targetList = document.getElementById('listSelected');
        selected.forEach(li => {
            li.classList.remove('active');
            li.classList.remove('list-group-item-danger'); // 移入時移除紅色標示
            targetList.appendChild(li);
        });
        updateShuttleCounts();
    });

    // 全部移入 (右到左)
    document.getElementById('btnMoveAllToLeft')?.addEventListener('click', () => {
        const all = document.querySelectorAll('#listUnselected .list-group-item:not(.disabled)');
        const targetList = document.getElementById('listSelected');
        all.forEach(li => {
            li.classList.remove('active');
            li.classList.remove('list-group-item-danger'); // 移入時移除紅色標示
            targetList.appendChild(li);
        });
        updateShuttleCounts();
    });

    // 儲存按鈕
    document.getElementById('saveRoundCandidatesBtn')?.addEventListener('click', async () => {
        const itemId = document.getElementById('adjustItemId').value;
        const roundId = document.getElementById('adjustRoundId').value;
        const btn = document.getElementById('saveRoundCandidatesBtn');
        
        // 抓取左欄所有 ID
        const finalIds = Array.from(document.querySelectorAll('#listSelected .list-group-item')).map(li => li.dataset.id);
        
        try {
            btn.disabled = true;
            btn.textContent = '儲存中...';
            
            const { doc, updateDoc } = window.fs;
            const db = window.firebaseDb;
            
            // 寫入到 rounds 子集合對應的 roundId 文件中
            await updateDoc(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', roundId), {
                candidate_ids: finalIds,
                updatedAt: window.fs.serverTimestamp()
            });
            
            Swal.fire('儲存成功', '輪次候選名單已更新', 'success');
            bootstrap.Modal.getInstance(document.getElementById('adjustRoundCandidatesModal')).hide();
            
            // 重新載入 items 並更新畫面
            await loadItems();
            
        } catch (error) {
            console.error("儲存輪次名單失敗:", error);
            Swal.fire('錯誤', error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '儲存輪次名單';
        }
    });
});

// ==========================================
// 金鑰管理模組
// ==========================================

let currentKeys = [];

window.openKeyManagement = async function(itemId, roundId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    const round = item.rounds.find(r => r.id === roundId);
    if (!round) return;

    document.getElementById('manageKeysItemId').value = itemId;
    document.getElementById('manageKeysRoundId').value = roundId;

    // 將下拉選單設定為目標
    const itemSelect = document.getElementById('keysItemSelect');
    if (itemSelect) itemSelect.value = itemId;
    const roundSelect = document.getElementById('keysRoundSelect');
    if (roundSelect) roundSelect.value = roundId;

    // 預設發放數量為全域設定的出席人數 (如果有)
    const defaultCount = currentElectionData.init_attending_count || '';
    document.getElementById('generateKeysCount').value = defaultCount;

    // 觸發側邊欄切換
    document.querySelector('.nav-link-btn[data-target="section-keys"]').click();

    // 顯示內容區塊 (原本隱藏)
    document.getElementById('keysContentContainer').style.display = 'block';

    await loadKeys(itemId, roundId);
};

async function loadKeys(itemId, roundId) {
    const { collection, query, where, getDocs } = window.fs;
    const db = window.firebaseDb;

    const tbody = document.getElementById('keysTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted py-3">載入中...</td></tr>';

    try {
        const keysRef = collection(db, 'elections', currentElectionId, 'keys');
        const q = query(keysRef, where('item_id', '==', itemId), where('round_id', '==', roundId));
        const snap = await getDocs(q);

        currentKeys = [];
        let issued = 0;
        let used = 0;
        let invalid = 0;

        snap.forEach(doc => {
            const data = doc.data();
            currentKeys.push({ id: doc.id, ...data });
            if (data.status === 'VALID') issued++;
            else if (data.status === 'USED') used++;
            else if (data.status === 'INVALID') invalid++;
        });

        // 更新統計數字 (已發放包含已使用，所以是 VALID + USED)
        document.getElementById('statKeysIssued').textContent = issued + used;
        document.getElementById('statKeysUsed').textContent = used;
        document.getElementById('statKeysInvalid').textContent = invalid;

        // 依據時間排序 (新的在前)
        currentKeys.sort((a, b) => {
            const timeA = a.created_at?.toMillis() || 0;
            const timeB = b.created_at?.toMillis() || 0;
            return timeB - timeA;
        });

        // 檢查是否已發放金鑰 (鎖定發放功能)
        const isIssued = currentKeys.length > 0;
        
        if (isIssued) {
            document.getElementById('btnGenerateKeys').disabled = true;
            document.getElementById('generateKeysCount').disabled = true;
            document.getElementById('btnDestroyAllKeys').style.display = 'inline-block';
            document.getElementById('btnPrintBallots').style.display = 'inline-block';
            document.getElementById('generateKeyHint').innerHTML = '<strong class="text-danger"><i class="fas fa-lock"></i> 產生金鑰功能已鎖定，因為本輪次已經發放過金鑰。若要重新配發，請先銷毀所有未使用金鑰。</strong>';
        } else {
            document.getElementById('btnGenerateKeys').disabled = false;
            document.getElementById('generateKeysCount').disabled = false;
            document.getElementById('btnDestroyAllKeys').style.display = 'none';
            document.getElementById('btnPrintBallots').style.display = 'none';
            document.getElementById('generateKeyHint').innerHTML = '系統將會產生一組全新的隨機金鑰（8碼純數字）。<strong class="text-danger">注意：一旦發放金鑰，該輪次即鎖定產生功能，若要重配需先銷毀。</strong>';
        }

        renderKeysTable();

    } catch (error) {
        console.error("載入金鑰失敗:", error);
        tbody.innerHTML = `<tr><td colspan="4" class="text-danger py-3">載入失敗: ${error.message}</td></tr>`;
    }
}

function renderKeysTable() {
    const tbody = document.getElementById('keysTableBody');
    tbody.innerHTML = '';

    if (currentKeys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted py-3">目前尚無金鑰，請使用上方功能產生。</td></tr>';
        return;
    }

    currentKeys.forEach(k => {
        let statusBadge = '';
        let actionBtn = '';
        if (k.status === 'VALID') {
            statusBadge = '<span class="badge bg-success">可使用</span>';
            actionBtn = `<button class="btn btn-sm btn-danger" onclick="invalidateKey('${k.id}')">作廢</button>`;
        } else if (k.status === 'USED') {
            statusBadge = '<span class="badge bg-secondary">已投票</span>';
            actionBtn = `<button class="btn btn-sm btn-outline-secondary" disabled>無法修改</button>`;
        } else {
            statusBadge = '<span class="badge bg-danger">已作廢</span>';
            actionBtn = `<button class="btn btn-sm btn-outline-secondary" disabled>已作廢</button>`;
        }

        const dateStr = k.created_at ? new Date(k.created_at.toMillis()).toLocaleString() : '剛剛';

        tbody.innerHTML += `
            <tr>
                <td class="fw-bold font-monospace text-primary fs-5">${k.code}</td>
                <td>${statusBadge}</td>
                <td>${dateStr}</td>
                <td>${actionBtn}</td>
            </tr>
        `;
    });
}

// 產生隨機八碼純數字
function generateRandomCode() {
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += Math.floor(Math.random() * 10).toString();
    }
    return result;
}

document.addEventListener('DOMContentLoaded', () => {
    // 批次產生金鑰
    document.getElementById('btnGenerateKeys')?.addEventListener('click', async () => {
        const count = parseInt(document.getElementById('generateKeysCount').value);
        if (!count || count <= 0) {
            Swal.fire('錯誤', '請輸入有效的發放數量', 'error');
            return;
        }

        const itemId = document.getElementById('manageKeysItemId').value;
        const roundId = document.getElementById('manageKeysRoundId').value;
        const btn = document.getElementById('btnGenerateKeys');

        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 產生中...';

            const { collection, doc, writeBatch, query, where, getDocs } = window.fs;
            const db = window.firebaseDb;
            const keysRef = collection(db, 'elections', currentElectionId, 'keys');
            
            // 防呆：檢查是否已經產生過金鑰
            const q = query(keysRef, where('item_id', '==', itemId), where('round_id', '==', roundId));
            const snap = await getDocs(q);
            if (!snap.empty) {
                throw new Error("此輪次已經產生過金鑰，為確保選票唯一性，不可重複產生！");
            }
            
            // Firebase Batch 最多 500 筆，超過需分批，這裡簡單處理，一般選舉不太會單輪超過500
            if (count > 450) {
                throw new Error("單次最多產生 450 組金鑰，請分批操作。");
            }

            const batch = writeBatch(db);
            const newKeys = [];

            for (let i = 0; i < count; i++) {
                const newRef = doc(keysRef); // 自動生成 ID
                const code = generateRandomCode();
                batch.set(newRef, {
                    code: code,
                    item_id: itemId,
                    round_id: roundId,
                    status: 'VALID',
                    created_at: window.fs.serverTimestamp(),
                    used_at: null
                });
                newKeys.push(code);
            }

            await batch.commit();

            Swal.fire('產生成功', `已成功產生 ${count} 組金鑰！`, 'success');
            document.getElementById('generateKeysCount').value = '';
            
            // 重新載入
            await loadKeys(itemId, roundId);

        } catch (error) {
            console.error("產生金鑰失敗:", error);
            Swal.fire('錯誤', error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '產生本輪金鑰';
        }
    });

    // 全域批次產生金鑰
    document.getElementById('btnGlobalGenerateKeys')?.addEventListener('click', async () => {
        const count = parseInt(document.getElementById('globalKeysCount').value);
        if (!count || count <= 0) {
            Swal.fire('錯誤', '請輸入有效的發放數量', 'error');
            return;
        }

        const btn = document.getElementById('btnGlobalGenerateKeys');
        
        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 全域掃描發放中...';

            const { collection, getDocs, doc, writeBatch } = window.fs;
            const db = window.firebaseDb;
            const keysRef = collection(db, 'elections', currentElectionId, 'keys');
            
            // 1. 取得現有所有金鑰，用以比對唯一性與過濾已發放的輪次
            const keysSnap = await getDocs(keysRef);
            const existingCodes = new Set();
            const issuedRounds = new Set(); // 記錄已發放過的 "itemId_roundId"

            keysSnap.forEach(d => {
                const data = d.data();
                existingCodes.add(data.code);
                issuedRounds.add(`${data.item_id}_${data.round_id}`);
            });

            let totalGenerated = 0;
            let currentBatch = writeBatch(db);
            let batchOpCount = 0;
            const BATCH_LIMIT = 450;
            const batches = [currentBatch];

            // 2. 掃描所有項次與輪次
            for (const item of allItems) {
                for (const round of item.rounds) {
                    const roundKey = `${item.id}_${round.id}`;
                    
                    // 若該輪次尚無金鑰，才發放
                    if (!issuedRounds.has(roundKey)) {
                        for (let i = 0; i < count; i++) {
                            let code;
                            do {
                                code = generateRandomCode();
                            } while (existingCodes.has(code));
                            
                            existingCodes.add(code);
                            
                            const newRef = doc(keysRef);
                            currentBatch.set(newRef, {
                                code: code,
                                item_id: item.id,
                                round_id: round.id,
                                status: 'VALID',
                                created_at: window.fs.serverTimestamp(),
                                used_at: null
                            });
                            
                            totalGenerated++;
                            batchOpCount++;
                            
                            // 若達到批次上限，開新的 batch
                            if (batchOpCount >= BATCH_LIMIT) {
                                currentBatch = writeBatch(db);
                                batches.push(currentBatch);
                                batchOpCount = 0;
                            }
                        }
                    }
                }
            }

            if (totalGenerated === 0) {
                Swal.fire('提示', '目前沒有任何「尚未發放金鑰」的新項次或新輪次！所有輪次都已經有金鑰了。', 'info');
                return;
            }

            // 3. 執行寫入
            for (const b of batches) {
                await b.commit();
            }

            Swal.fire('產生成功', `已成功為未發放的輪次產生總計 ${totalGenerated} 組全域金鑰！`, 'success');
            document.getElementById('globalKeysCount').value = '';
            
            // 若目前畫面剛好停在某個輪次，重新載入該輪次金鑰
            const currentItemId = document.getElementById('manageKeysItemId').value;
            const currentRoundId = document.getElementById('manageKeysRoundId').value;
            if (currentItemId && currentRoundId) {
                await loadKeys(currentItemId, currentRoundId);
            }

        } catch (error) {
            console.error("全域產生金鑰失敗:", error);
            Swal.fire('錯誤', error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '一鍵發放金鑰';
        }
    });

    // 列印實體選票 (單一輪次)
    document.getElementById('btnPrintBallots')?.addEventListener('click', async () => {
        if (currentKeys.length === 0) {
            Swal.fire('提示', '目前沒有金鑰可供列印', 'info');
            return;
        }

        const validKeys = currentKeys.filter(k => k.status === 'VALID');
        if (validKeys.length === 0) {
            Swal.fire('提示', '沒有狀態為「可使用」的金鑰', 'info');
            return;
        }

        // 直接呼叫列印函數 (不再鎖定 keys_printed)
        printBallotsA4(validKeys);
    });

    // 一鍵列印所有未結束輪次選票
    document.getElementById('btnGlobalPrintAll')?.addEventListener('click', async () => {
        try {
            const btn = document.getElementById('btnGlobalPrintAll');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 載入中...';

            const { collection, getDocs, query, where } = window.fs;
            const db = window.firebaseDb;
            
            // 找出全域所有 VALID 金鑰
            const keysRef = collection(db, 'elections', currentElectionId, 'keys');
            const q = query(keysRef, where('status', '==', 'VALID'));
            const snap = await getDocs(q);
            
            const validKeys = [];
            snap.forEach(doc => validKeys.push({ id: doc.id, ...doc.data() }));

            if (validKeys.length === 0) {
                Swal.fire('提示', '目前沒有任何「可使用」狀態的金鑰可供列印', 'info');
                return;
            }

            printBallotsA4(validKeys);

        } catch (error) {
            console.error('列印失敗', error);
            Swal.fire('錯誤', '載入選票失敗: ' + error.message, 'error');
        } finally {
            const btn = document.getElementById('btnGlobalPrintAll');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-print"></i> 1. 一鍵列印「所有輪次」選票';
        }
    });

    // 列印單一項次(三輪)
    document.getElementById('btnItemPrintAll')?.addEventListener('click', async () => {
        const itemId = document.getElementById('keysItemSelect').value;
        if (!itemId) {
            Swal.fire('提示', '請先在下方「選擇要操作的項次」下拉選單中選擇項次！', 'warning');
            return;
        }

        try {
            const btn = document.getElementById('btnItemPrintAll');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 載入中...';

            const { collection, getDocs, query, where } = window.fs;
            const db = window.firebaseDb;
            
            const keysRef = collection(db, 'elections', currentElectionId, 'keys');
            const q = query(keysRef, where('item_id', '==', itemId), where('status', '==', 'VALID'));
            const snap = await getDocs(q);
            
            const validKeys = [];
            snap.forEach(doc => validKeys.push({ id: doc.id, ...doc.data() }));

            if (validKeys.length === 0) {
                Swal.fire('提示', '此項次目前沒有任何「可使用」狀態的金鑰', 'info');
                return;
            }

            printBallotsA4(validKeys);

        } catch (error) {
            console.error('列印失敗', error);
            Swal.fire('錯誤', '載入選票失敗: ' + error.message, 'error');
        } finally {
            const btn = document.getElementById('btnItemPrintAll');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-print"></i> 2. 僅列印「下方所選項次 (三輪)」';
        }
    });

    // 銷毀所有未使用金鑰解除鎖定
    document.getElementById('btnDestroyAllKeys')?.addEventListener('click', () => {
        Swal.fire({
            title: '危險操作確認',
            html: '<strong class="text-danger">這將會作廢本輪次所有「未使用」的金鑰！</strong><br>已印出的選票將全數失效，並且解除列印鎖定，允許您重新產生金鑰。<br>確定要執行嗎？',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#6c757d',
            confirmButtonText: '是的，全部銷毀',
            cancelButtonText: '取消'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const { collection, query, where, getDocs, writeBatch, doc, updateDoc } = window.fs;
                    const db = window.firebaseDb;
                    
                    const itemId = document.getElementById('manageKeysItemId').value;
                    const roundId = document.getElementById('manageKeysRoundId').value;

                    // 1. 找出所有 VALID 的金鑰
                    const keysRef = collection(db, 'elections', currentElectionId, 'keys');
                    const q = query(keysRef, where('item_id', '==', itemId), where('round_id', '==', roundId), where('status', '==', 'VALID'));
                    const snap = await getDocs(q);

                    if (!snap.empty) {
                        const batch = writeBatch(db);
                        snap.forEach(d => {
                            batch.update(d.ref, { status: 'INVALID', updatedAt: window.fs.serverTimestamp() });
                        });
                        await batch.commit();
                    }

                    // 取消 keys_printed 邏輯，作廢後只重新載入金鑰列表
                    Swal.fire('成功', '所有未使用金鑰已銷毀。', 'success');
                    
                    await loadItems();
                    await loadKeys(itemId, roundId);

                } catch (error) {
                    console.error('銷毀失敗', error);
                    Swal.fire('錯誤', '銷毀失敗: ' + error.message, 'error');
                }
            }
        });
    });
});

function printBallotsA4(keysToPrint) {
    if (!keysToPrint || keysToPrint.length === 0) return;

    // 將金鑰依據項次與輪次分組，確保不同輪次絕對不會印在同一頁
    const groupedKeys = {};
    keysToPrint.forEach(k => {
        const groupKey = `${k.item_id}__${k.round_id}`;
        if (!groupedKeys[groupKey]) groupedKeys[groupKey] = [];
        groupedKeys[groupKey].push(k);
    });

    // 建立隱藏的 iframe 進行列印，避免彈出視窗被阻擋或右鍵無法列印的問題
    let printIframe = document.getElementById('ballotPrintIframe');
    if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'ballotPrintIframe';
        // 使用 visibility hidden 和絕對定位，避免 display:none 導致 QR Code 無法渲染
        printIframe.style.position = 'absolute';
        printIframe.style.top = '-10000px';
        printIframe.style.left = '-10000px';
        printIframe.style.width = '210mm';
        printIframe.style.height = '297mm';
        document.body.appendChild(printIframe);
    }
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>列印選票</title>
        <style>
            @page { size: A4 portrait; margin: 5mm; }
            body { margin: 0; padding: 0; background: #fff; font-family: '微軟正黑體', sans-serif; }
            .page { width: 200mm; height: 287mm; display: flex; flex-wrap: wrap; box-sizing: border-box; page-break-after: always; padding: 0; gap: 4mm; margin: 0 auto; justify-content: center; align-content: flex-start; }
            /* 2x2 Grid: each ballot is approx 95mm x 135mm (A6 size) */
            .ballot { width: calc(50% - 2mm); height: 140mm; padding: 8mm; box-sizing: border-box; border: 1px dashed #999; position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; background: transparent; }
            .watermark { position: absolute; top: 35%; left: 50%; transform: translate(-50%, -50%); width: 70%; opacity: 0.15; z-index: -1; pointer-events: none; }
            .content { position: relative; z-index: 1; text-align: center; display: flex; flex-direction: column; height: 100%; justify-content: space-between; }
            .header h3 { margin: 0 0 5px 0; font-size: 16px; color: #333; text-shadow: 1px 1px 2px rgba(255,255,255,0.8); }
            .header h2 { margin: 0 0 10px 0; font-size: 20px; color: #000; font-weight: bold; text-shadow: 1px 1px 2px rgba(255,255,255,0.8); }
            .header h4 { margin: 0; font-size: 14px; color: #555; text-shadow: 1px 1px 2px rgba(255,255,255,0.8); }
            .qr-container { display: flex; flex-direction: column; justify-content: center; align-items: center; border: 2px solid #333; border-radius: 8px; padding: 10px; background: #f8f9fa; margin-top: auto; position: relative; }
            .qr-container span { font-size: 12px; color: #666; margin-bottom: 5px; }
            .qr-container strong { font-size: 24px; letter-spacing: 5px; color: #000; margin-bottom: 10px; }
            .qr-code { width: 120px; height: 120px; background: #fff; padding: 5px; border: 1px solid #ddd; z-index: 2; position: relative; }
            .hint { font-size: 11px; margin-top: 10px; font-weight: bold; text-align: center; }
        </style>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    </head>
    <body>
    `;

    // 依序處理每個輪次的群組
    for (const groupKey in groupedKeys) {
        const group = groupedKeys[groupKey];
        const firstKey = group[0];
        
        // 查找對應的名稱
        const item = allItems.find(i => i.id === firstKey.item_id);
        const roundTitle = getRoundName(firstKey.round_id);
        const itemTitle = item ? item.title : '未知項次';

        // 生成該群組的頁面 (4張選票一頁)
        for (let i = 0; i < group.length; i += 4) {
            html += '<div class="page">';
            for (let j = 0; j < 4; j++) {
                if (i + j < group.length) {
                    const k = group[i + j];
                    const voteUrl = `${window.location.origin}/voter.html?eid=${currentElectionId}&key=${k.code}`;
                    const sealHtml = currentOrgData?.seal_url ? `<img src="${currentOrgData.seal_url}" class="watermark">` : '';
                    
                    html += `
                    <div class="ballot">
                        ${sealHtml}
                        <div class="content">
                            <div class="header">
                                <h3>${currentOrgData?.name || '教會機構'}</h3>
                                <h2>${currentElectionData?.name || '選舉'}</h2>
                                <h4>${itemTitle} - ${roundTitle}</h4>
                            </div>
                            <div class="qr-container">
                                <span>請掃描下方 QR Code 或於網頁輸入此金鑰</span>
                                <strong>${k.code}</strong>
                                <div id="qr-${k.code}" class="qr-code"></div>
                            </div>
                            <div class="hint">⚠️ 注意：此金鑰限用一次，投票後即失效。請勿外流。</div>
                        </div>
                    </div>
                    <script>
                        setTimeout(() => {
                            new QRCode(document.getElementById("qr-${k.code}"), {
                                text: "${voteUrl}",
                                width: 110,
                                height: 110,
                                colorDark : "#000000",
                                colorLight : "#ffffff",
                                correctLevel : QRCode.CorrectLevel.M
                            });
                        }, 100);
                    </script>
                    `;
                }
            }
            html += '</div>';
        }
    }

    html += `
    <script>
        // 等待 QR Code 渲染完成後自動觸發 iframe 的列印
        setTimeout(() => {
            window.print();
        }, 1500);
    </script>
    </body></html>`;

    // 寫入 iframe 並關閉文件流
    const doc = printIframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
}
window.invalidateKey = function(keyId) {
    Swal.fire({
        title: '確定要作廢此金鑰嗎？',
        text: "作廢後該金鑰將無法用於投票，此操作無法復原！",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: '確定作廢',
        cancelButtonText: '取消'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const { doc, updateDoc } = window.fs;
                const db = window.firebaseDb;
                
                await updateDoc(doc(db, 'elections', currentElectionId, 'keys', keyId), {
                    status: 'INVALID',
                    updatedAt: window.fs.serverTimestamp()
                });
                
                const itemId = document.getElementById('manageKeysItemId').value;
                const roundId = document.getElementById('manageKeysRoundId').value;
                await loadKeys(itemId, roundId);

            } catch (error) {
                console.error("作廢失敗:", error);
                Swal.fire('錯誤', '作廢失敗: ' + error.message, 'error');
            }
        }
    });
};

// ==========================================
// 開票中心模組 (Tally Center)
// ==========================================

let currentTallyData = {
    itemId: null,
    roundId: null,
    candidates: [],
    digitalIssued: 0,
    digitalUsed: 0,
    digitalVotesMap: {}
};

window.openTallyCenter = async function(itemId, roundId) {
    const item = allItems.find(i => i.id === itemId);
    const round = item?.rounds.find(r => r.id === roundId);
    if (!item || !round) return;

    currentTallyData.itemId = itemId;
    currentTallyData.roundId = roundId;
    currentTallyData.candidates = [];
    currentTallyData.digitalVotesMap = {};

    document.getElementById('tallyTitle').textContent = `${item.title} - ${getRoundName(round.id)}`;
    document.getElementById('tallyItemId').value = itemId;
    
    // 建立下拉選單選項
    const itemSelect = document.getElementById('tallyItemSelect');
    itemSelect.innerHTML = '<option value="">請選擇...</option>';
    allItems.forEach(i => {
        itemSelect.innerHTML += `<option value="${i.id}">${i.title}</option>`;
    });
    itemSelect.value = itemId;
    document.getElementById('tallyRoundId').value = roundId;
    document.getElementById('tallyRoundSelect').value = roundId;
    document.getElementById('tallyQuota').textContent = item.seats || 0;

    // 狀態設定
    const badge = document.getElementById('tallyStatusBadge');
    const btnEnd = document.getElementById('btnEndVoting');
    const btnReopen = document.getElementById('btnReopenVoting');
    const btnPublish = document.getElementById('btnPublishTally');

    if (round.status === 'ACTIVE') {
        badge.textContent = '狀態：投票進行中';
        badge.className = 'badge bg-success me-3 fs-6';
        btnEnd.style.display = 'inline-block';
        btnReopen.style.display = 'none';
        btnPublish.disabled = true;
    } else if (round.status === 'CLOSED') {
        badge.textContent = '狀態：開票結算中';
        badge.className = 'badge bg-warning text-dark me-3 fs-6';
        btnEnd.style.display = 'none';
        btnReopen.style.display = 'inline-block';
        btnPublish.disabled = false;
    } else {
        badge.textContent = '狀態：結果已發布';
        badge.className = 'badge bg-secondary me-3 fs-6';
        btnEnd.style.display = 'none';
        btnReopen.style.display = 'none';
        btnPublish.disabled = true; // 已經發布過了
    }

    // 參數預設值
    document.getElementById('tallyQuorumBase').value = round.quorum_base || currentElectionData.quorum_base || 'ATTENDING';
    document.getElementById('tallyAttendingCount').value = round.attending_count || currentElectionData.init_attending_count || 0;
    
    // 初始化新的輸入框
    document.getElementById('tallyDigitalIssued').value = round.digital_issued || 0;
    document.getElementById('tallyPaperIssued').value = round.paper_issued || 0;
    document.getElementById('tallyPaperReceived').value = round.paper_received || 0;
    document.getElementById('tallyPaperBlank').value = round.paper_blank || 0;

    // 觸發側邊欄切換
    document.querySelector('.nav-link-btn[data-target="section-tally"]').click();

    // 顯示內容區塊 (原本隱藏)
    document.getElementById('tallyContentContainer').style.display = 'block';

    // 非同步載入金鑰統計與數位選票
    await loadTallyStats(itemId, roundId);
    
    // 取得候選人清單
    const candidateIds = round.candidate_ids || [];
    currentTallyData.candidates = allCandidates.filter(c => candidateIds.includes(c.id)).map(c => {
        const digi = currentTallyData.digitalVotesMap[c.id] || 0;
        const paper = (round.paper_votes && round.paper_votes[c.id]) ? parseInt(round.paper_votes[c.id]) : 0;
        const isElected = round.elected_ids ? round.elected_ids.includes(c.id) : false;
        return {
            ...c,
            digital_votes: digi,
            paper_votes: paper,
            total_votes: digi + paper,
            is_elected: isElected
        };
    });

    updateTallyThreshold();
    renderTallyTable();
};

async function loadTallyStats(itemId, roundId) {
    const { collection, query, where, getDocs } = window.fs;
    const db = window.firebaseDb;

    // 1. 取得金鑰統計 (僅用於內部參考或顯示，不再用於預設發票數)
    const keysRef = collection(db, 'elections', currentElectionId, 'keys');
    const qKeys = query(keysRef, where('item_id', '==', itemId), where('round_id', '==', roundId));
    const snapKeys = await getDocs(qKeys);
    
    let digitalUsed = 0;
    snapKeys.forEach(doc => {
        const d = doc.data();
        if (d.status === 'USED') digitalUsed++;
    });
    
    currentTallyData.digitalUsed = digitalUsed;
    document.getElementById('tallyDigitalUsed').textContent = digitalUsed;

    // 2. 取得選票統計 (分組計算每個人的得票)
    // 註：這需要後端實際有寫入 votes 集合
    currentTallyData.digitalVotesMap = {};
    const votesRef = collection(db, 'elections', currentElectionId, 'votes');
    const qVotes = query(votesRef, where('item_id', '==', itemId), where('round_id', '==', roundId));
    const snapVotes = await getDocs(qVotes);
    let digitalBlankCount = 0;
    snapVotes.forEach(doc => {
        const d = doc.data();
        if (d.candidate_ids && Array.isArray(d.candidate_ids)) {
            if (d.candidate_ids.length === 0) {
                digitalBlankCount++;
            } else {
                d.candidate_ids.forEach(cid => {
                    if (!currentTallyData.digitalVotesMap[cid]) {
                        currentTallyData.digitalVotesMap[cid] = 0;
                    }
                    currentTallyData.digitalVotesMap[cid]++;
                });
            }
        }
    });
    
    currentTallyData.digitalBlank = digitalBlankCount;
    document.getElementById('tallyDigitalBlank').textContent = digitalBlankCount;
}

async function doSaveTallyData(itemId, roundId) {
    try {
        const { doc, setDoc } = window.fs;
        const db = window.firebaseDb;

        const paperVotesMap = {};
        const electedIds = [];

        document.querySelectorAll('.paper-vote-input').forEach(input => {
            const val = parseInt(input.value) || 0;
            if (val > 0) paperVotesMap[input.dataset.id] = val;
        });
        document.querySelectorAll('.elected-checkbox:checked').forEach(chk => {
            electedIds.push(chk.dataset.id);
        });

        // 正確更新子集合中的 round 文件
        await setDoc(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', roundId), {
            quorum_base: document.getElementById('tallyQuorumBase').value,
            attending_count: parseInt(document.getElementById('tallyAttendingCount').value) || 0,
            digital_issued: parseInt(document.getElementById('tallyDigitalIssued').value) || 0,
            paper_issued: parseInt(document.getElementById('tallyPaperIssued').value) || 0,
            paper_received: parseInt(document.getElementById('tallyPaperReceived').value) || 0,
            paper_blank: parseInt(document.getElementById('tallyPaperBlank').value) || 0,
            paper_votes: paperVotesMap,
            elected_ids: electedIds,
            updatedAt: window.fs.serverTimestamp()
        }, { merge: true });

        // 寫回 candidates 總表 (儲存即同步總表)
        const { writeBatch } = window.fs;
        const batch = writeBatch(db);
        const item = allItems.find(i => i.id === itemId);
        
        // 找出所有此輪的候選人，根據是否被勾選當選來更新
        currentTallyData.candidates.forEach(c => {
            const isElectedNow = electedIds.includes(c.id);
            const candRef = doc(db, 'elections', currentElectionId, 'candidates', c.id);
            if (isElectedNow) {
                batch.update(candRef, {
                    elected_item: item.title,
                    updatedAt: window.fs.serverTimestamp()
                });
            } else if (c.elected_item === item.title) {
                // 如果原本有當選此項次，但現在被取消勾選，則清空
                batch.update(candRef, {
                    elected_item: null,
                    updatedAt: window.fs.serverTimestamp()
                });
            }
        });
        await batch.commit();
        
        // **重要：儲存後必須重新載入全域資料，確保後續操作抓到最新數據**
        await loadItems();
        
        return true;
    } catch (error) {
        console.error("儲存失敗:", error);
        throw error;
    }
}

function updateTallyThreshold() {
    const baseType = document.getElementById('tallyQuorumBase').value;
    const attending = parseInt(document.getElementById('tallyAttendingCount').value) || 0;
    const digitalIssued = parseInt(document.getElementById('tallyDigitalIssued').value) || 0;
    const paperIssued = parseInt(document.getElementById('tallyPaperIssued').value) || 0;
    const totalIssued = digitalIssued + paperIssued;
    
    const digitalUsed = currentTallyData.digitalUsed || 0;
    const paperReceived = parseInt(document.getElementById('tallyPaperReceived').value) || 0;
    const totalReceived = digitalUsed + paperReceived;

    const digitalBlank = currentTallyData.digitalBlank || 0;
    const paperBlank = parseInt(document.getElementById('tallyPaperBlank').value) || 0;
    const totalBlank = digitalBlank + paperBlank;

    // 更新統計顯示
    document.getElementById('tallyTotalIssued').textContent = totalIssued;
    document.getElementById('tallyTotalReceived').textContent = totalReceived;
    document.getElementById('tallyTotalBlank').textContent = totalBlank;
    
    let baseNumber = 0;
    let formulaText = "";

    if (baseType === 'ATTENDING') {
        baseNumber = attending;
        formulaText = `(${attending} / 2) + 1`;
    } else {
        baseNumber = totalIssued;
        formulaText = `(${totalIssued} / 2) + 1`;
    }

    const threshold = Math.floor(baseNumber / 2) + 1;
    document.getElementById('tallyThreshold').textContent = threshold;
    document.getElementById('tallyThresholdFormula').textContent = formulaText;

    // 觸發重新繪製表格以更新過半標示
    renderTallyTable(threshold);
}

// 監聽輸入框變更以即時更新門檻與統計
document.addEventListener('DOMContentLoaded', () => {
    ['tallyQuorumBase', 'tallyAttendingCount', 'tallyDigitalIssued', 'tallyPaperIssued', 'tallyPaperReceived', 'tallyPaperBlank'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateTallyThreshold);
        document.getElementById(id)?.addEventListener('change', updateTallyThreshold);
    });
});

function renderTallyTable(threshold) {
    if (threshold === undefined) {
        threshold = parseInt(document.getElementById('tallyThreshold').textContent) || 0;
    }

    const tbody = document.getElementById('tallyTableBody');
    tbody.innerHTML = '';

    if (currentTallyData.candidates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-muted py-5">此輪次尚無候選人</td></tr>';
        return;
    }

    currentTallyData.candidates.forEach((c, index) => {
        const isPassed = c.total_votes >= threshold;
        const passBadge = isPassed ? '<span class="badge bg-danger"><i class="fas fa-check"></i> 達標</span>' : '<span class="badge bg-secondary">未過半</span>';
        
        // 判斷是否為保障名額
        const item = allItems.find(i => i.id === currentTallyData.itemId);
        const isForced = item && item.forced_candidate_id === c.id;
        const forceBadge = isForced ? '<br><span class="badge bg-warning text-dark mt-1">保障名額</span>' : '';

        // 取出目前的紙本得票 (供綁定 input)
        const paperVal = c.paper_votes || 0;
        
        tbody.innerHTML += `
            <tr data-id="${c.id}">
                <td class="fw-bold">${c.number || ''}</td>
                <td>
                    <div class="fw-bold fs-6">${c.name}</div>
                    ${c.district ? `<small class="text-muted">[${c.district}]</small>` : ''}
                    ${forceBadge}
                </td>
                <td class="fs-5 text-secondary">${c.digital_votes}</td>
                <td>
                    <input type="number" class="form-control form-control-sm text-center border-success paper-vote-input" 
                           data-id="${c.id}" value="${paperVal}" min="0" style="width: 80px; margin: 0 auto;">
                </td>
                <td class="fs-4 fw-bold text-primary total-vote-display">${c.total_votes}</td>
                <td>${passBadge}</td>
                <td>
                    <div class="form-check d-flex justify-content-center">
                        <input class="form-check-input elected-checkbox" type="checkbox" data-id="${c.id}" 
                               style="transform: scale(1.5);" ${c.is_elected ? 'checked' : ''}>
                    </div>
                </td>
            </tr>
        `;
    });

    // 綁定紙本票數輸入事件以即時加總
    document.querySelectorAll('.paper-vote-input').forEach(input => {
        input.addEventListener('input', function() {
            const cid = this.dataset.id;
            const cand = currentTallyData.candidates.find(c => c.id === cid);
            if (cand) {
                cand.paper_votes = parseInt(this.value) || 0;
                cand.total_votes = cand.digital_votes + cand.paper_votes;
                this.closest('tr').querySelector('.total-vote-display').textContent = cand.total_votes;
                // 延遲一點重新繪製，避免打字中斷，這裡採用單純更新 DOM 或呼叫 render
                // 若要精確過半標記，應該重新 render，但會打斷 input focus。所以簡單處理。
                const isPassed = cand.total_votes >= threshold;
                const passTd = this.closest('tr').children[5];
                passTd.innerHTML = isPassed ? '<span class="badge bg-danger"><i class="fas fa-check"></i> 達標</span>' : '<span class="badge bg-secondary">未過半</span>';
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // 排序功能
    document.getElementById('btnSortTally')?.addEventListener('click', () => {
        currentTallyData.candidates.sort((a, b) => b.total_votes - a.total_votes);
        renderTallyTable();
    });

    // 結束數位投票
    document.getElementById('btnEndVoting')?.addEventListener('click', async () => {
        await updateRoundStatus('CLOSED', '結束投票將鎖定所有數位金鑰，確定繼續？');
    });

    // 重新開放
    document.getElementById('btnReopenVoting')?.addEventListener('click', async () => {
        const itemId = currentTallyData.itemId;
        const roundId = currentTallyData.roundId;
        if (checkAnyActiveRound(itemId, roundId)) return;
        
        await updateRoundStatus('ACTIVE', '確定要重新開放數位投票嗎？');
    });

    // 開啟投影畫面按鈕
    document.getElementById('btnOpenProjector')?.addEventListener('click', () => {
        const itemId = currentTallyData.itemId;
        const roundId = currentTallyData.roundId;
        if (!itemId || !roundId) {
            Swal.fire('錯誤', '請先選擇要操作的選舉與輪次', 'error');
            return;
        }
        const resultUrl = `result.html?election_id=${currentElectionId}&item_id=${itemId}&round_id=${roundId}`;
        window.open(resultUrl, '_blank', 'width=1200,height=800');
    });

    // 儲存開票數據
    document.getElementById('btnSaveTallyResults')?.addEventListener('click', async () => {
        const itemId = document.getElementById('tallyItemId').value;
        const roundId = document.getElementById('tallyRoundId').value;
        if (!itemId || !roundId) return;

        const btn = document.getElementById('btnSaveTallyResults');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 儲存中...';

        try {
            await doSaveTallyData(itemId, roundId);
            Swal.fire('成功', '開票數據已儲存！', 'success');
            await loadItems(); // 重新載入最新資料
        } catch (error) {
            Swal.fire('錯誤', error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 儲存開票數據';
        }
    });

    // 發布選舉結果
    document.getElementById('btnPublishTally')?.addEventListener('click', async () => {
        Swal.fire({
            title: '確定要發布選舉結果嗎？',
            text: `發布前系統會自動幫您儲存最新開票數據。發布後，投影畫面將會自動切換為顯示選舉結果。`,
            icon: 'info',
            showCancelButton: true,
            confirmButtonColor: '#ffc107',
            cancelButtonColor: '#6c757d',
            confirmButtonText: '是的，發布並開啟投影'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const itemId = currentTallyData.itemId;
                    const roundId = currentTallyData.roundId;

                    // 1. 自動儲存
                    await doSaveTallyData(itemId, roundId);

                    const { doc, setDoc } = window.fs;
                    const db = window.firebaseDb;

                    // 2. 更新狀態為 PUBLISHED
                    await setDoc(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', roundId), {
                        status: 'PUBLISHED',
                        updatedAt: window.fs.serverTimestamp()
                    }, { merge: true });

                    Swal.fire('發布成功', '狀態已更新。', 'success').then(() => {
                        // 開啟大字體投影畫面 (若尚未開啟)
                        const resultUrl = `result.html?election_id=${currentElectionId}&item_id=${itemId}&round_id=${roundId}`;
                        window.open(resultUrl, '_blank', 'width=1200,height=800');
                        
                        // 嘗試檢查是否需要進行下一輪
                        checkNextRoundWizard(itemId, roundId);
                    });
                    
                    // **重要：發布後重新載入開票中心以更新 UI 狀態 (從「開票結算中」變成「結果已發布」)**
                    openTallyCenter(itemId, roundId);
                } catch (error) {
                    console.error("發布失敗:", error);
                    Swal.fire('錯誤', error.message, 'error');
                }
            }
        });
    });
});

async function updateRoundStatus(newStatus, confirmMsg) {
    Swal.fire({
        title: confirmMsg,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '確定',
        cancelButtonText: '取消'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const { doc, setDoc } = window.fs;
                const db = window.firebaseDb;

                const itemId = currentTallyData.itemId;
                const roundId = currentTallyData.roundId;

                await setDoc(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', roundId), {
                    status: newStatus,
                    updatedAt: window.fs.serverTimestamp()
                }, { merge: true });

                Swal.fire('狀態更新成功', '', 'success');
                await loadItems();
                // 重新載入 Tally Center
                openTallyCenter(itemId, roundId);
                
                
            } catch (error) {
                console.error("更新狀態失敗:", error);
                Swal.fire('錯誤', error.message, 'error');
            }
        }
    });
}

// 檢查是否已有 ACTIVE 輪次
window.checkAnyActiveRound = function(excludeItemId = null, excludeRoundId = null) {
    let hasActiveRound = false;
    let activeRoundName = '';
    for (const item of allItems) {
        for (const round of item.rounds) {
            if (round.status === 'ACTIVE' && (item.id !== excludeItemId || round.id !== excludeRoundId)) {
                hasActiveRound = true;
                activeRoundName = `${item.title} - ${getRoundName(round.id)}`;
                break;
            }
        }
        if (hasActiveRound) break;
    }

    if (hasActiveRound) {
        Swal.fire('錯誤', `目前有尚未結束的投票（${activeRoundName}）。同一時間只能有一個輪次進行投票，請先結束該輪投票再開啟新輪次。`, 'error');
        return true;
    }
    return false;
}


// ==========================================
// 晉級下一輪設定嚮導 (Next Round Wizard)
// ==========================================

window.checkNextRoundWizard = async function(itemId, currentRoundId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;

    const roundIndex = item.rounds.findIndex(r => r.id === currentRoundId);
    if (roundIndex === -1 || roundIndex === item.rounds.length - 1) {
        // 沒有下一輪，或者找不到當前輪次
        return;
    }

    const nextRound = item.rounds[roundIndex + 1];

    // 重新載入最新候選人資料，確保 elected_item 是最新的
    await loadCandidates();

    // 計算已當選人數
    const electedCount = allCandidates.filter(c => c.elected_item === item.title).length;
    const remainingQuota = (item.seats || 0) - electedCount;

    if (remainingQuota <= 0) {
        Swal.fire('選舉結束', `【${item.title}】的應選名額 (${item.seats}名) 已滿，無須進行下一輪！`, 'success');
        return;
    }

    // 顯示嚮導
    document.getElementById('wizardItemId').value = itemId;
    document.getElementById('wizardNextRoundId').value = nextRound.id;
    
    document.getElementById('wizardTotalQuota').textContent = item.seats || 0;
    document.getElementById('wizardElectedCount').textContent = electedCount;
    document.getElementById('wizardRemainingQuota').textContent = remainingQuota;

    const modal = new bootstrap.Modal(document.getElementById('nextRoundWizardModal'));
    modal.show();
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnConfirmNextRound')?.addEventListener('click', async () => {
        const itemId = document.getElementById('wizardItemId').value;
        const nextRoundId = document.getElementById('wizardNextRoundId').value;
        const filterType = document.querySelector('input[name="wizardFilterType"]:checked').value;
        
        const remainingQuota = parseInt(document.getElementById('wizardRemainingQuota').textContent) || 0;
        
        const btn = document.getElementById('btnConfirmNextRound');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 處理中...';

        try {
            // 從 currentTallyData 取得上一輪的候選人與得票排序
            // (因為剛開票完，currentTallyData 內存有最新的計算結果)
            let candidatesList = [...currentTallyData.candidates];
            
            // 排除已當選、或中途被設為不可被選者
            candidatesList = candidatesList.filter(c => !c.is_elected && !c.is_ineligible);
            
            // 依得票數由高至低排序
            candidatesList.sort((a, b) => b.total_votes - a.total_votes);

            let limit = candidatesList.length; // 預設全部

            if (filterType === 'MULTIPLY') {
                const n = parseInt(document.getElementById('wizardFilterMultiplyN').value) || 2;
                limit = remainingQuota * n;
            } else if (filterType === 'ADD') {
                const n = parseInt(document.getElementById('wizardFilterAddN').value) || 1;
                limit = remainingQuota + n;
            }

            // 擷取前 limit 名
            const nextRoundIds = candidatesList.slice(0, limit).map(c => c.id);

            // 如果有保障名額，且該人尚未當選，確保他進入下一輪
            const item = allItems.find(i => i.id === itemId);
            if (item && item.forced_candidate_id) {
                const forceCand = allCandidates.find(c => c.id === item.forced_candidate_id);
                // 確定保障名額還沒當選
                if (forceCand && forceCand.elected_item !== item.title) {
                    if (!nextRoundIds.includes(forceCand.id)) {
                        nextRoundIds.push(forceCand.id);
                    }
                }
            }

            const { doc, updateDoc } = window.fs;
            const db = window.firebaseDb;

            const updatedRounds = [...item.rounds];
            const nextRoundIndex = updatedRounds.findIndex(r => r.id === nextRoundId);
            updatedRounds[nextRoundIndex].candidate_ids = nextRoundIds;

            await updateDoc(doc(db, 'elections', currentElectionId, 'items', itemId), {
                rounds: updatedRounds,
                updatedAt: window.fs.serverTimestamp()
            });

            Swal.fire('設定成功', `已將 ${nextRoundIds.length} 名候選人帶入下一輪！`, 'success');
            bootstrap.Modal.getInstance(document.getElementById('nextRoundWizardModal')).hide();
            
            await loadItems();

        } catch (error) {
            console.error("產生下一輪名單失敗:", error);
            Swal.fire('錯誤', error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '產生下一輪名單';
        }
    });
});
