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

        // 4. 更新畫面文字
        document.getElementById('sidebarElectionName').textContent = currentElectionData.name;
        document.getElementById('pageTitle').textContent = `管理：${currentElectionData.name}`;

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
    // 重置 input，允許重複上傳同一個檔案
    this.value = '';
});

async function processExcelData(rows) {
    // 假設格式: 編號, 姓名, 分區, 單位, 候選資格
    // 第 0 列是標題，從第 1 列開始
    let validCount = 0;
    
    Swal.fire({
        title: '匯入中...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    try {
        const { collection, addDoc, serverTimestamp } = window.fs;
        const db = window.firebaseDb;
        const candidatesRef = collection(db, 'elections', currentElectionId, 'candidates');

        // TODO: 為了效能，這裡可以使用 batch 寫入，但此處簡單逐筆上傳
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
            
            await addDoc(candidatesRef, candidateData);
            validCount++;
        }
        
        await loadCandidates();
        Swal.fire('成功', `已成功匯入 ${validCount} 筆候選人資料！`, 'success');
        
    } catch (error) {
        console.error("匯入失敗:", error);
        Swal.fire('錯誤', '匯入過程中發生錯誤: ' + error.message, 'error');
    }
}

window.deleteCandidate = async function(id) {
    const result = await Swal.fire({
        title: '確定刪除？',
        text: "刪除後無法復原，是否確定？",
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

    try {
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
            is_ineligible: document.getElementById('editCandIneligibleInput').checked
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
            
            roundsHtml += `
                <div class="d-flex justify-content-between align-items-center border-bottom py-2">
                    <div>
                        <strong>${getRoundName(round.id)}</strong>
                        <span class="badge bg-${statusColor} ms-2">${statusText}</span>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-outline-primary" onclick="openRoundCandidates('${item.id}', '${round.id}')">調整名單 (${round.candidate_ids ? round.candidate_ids.length : 0}人)</button>
                        <button class="btn btn-sm btn-success" onclick="startRound('${item.id}', '${round.id}')" ${round.status !== 'PENDING' ? 'disabled' : ''}>開始投票</button>
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
}

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
        await setDoc(round2Ref, { status: 'PENDING', candidate_ids: [] });
        await setDoc(round3Ref, { status: 'PENDING', candidate_ids: [] });

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
    // TODO: 需實作連鎖刪除 (刪除 items/{itemId} 及其 rounds)
    // 因 Firestore 前端 SDK 不易遞迴刪除集合，建議呼叫後端 API，目前先提供提示。
    Swal.fire('提醒', '徹底刪除項次功能將於後續版本提供。', 'info');
}

window.openRoundCandidates = function(itemId, roundId) {
    // 未來實作：打開 Modal，列出所有人，打勾的代表參與這輪
    Swal.fire('提醒', '調整名單 Modal 正在開發中，將於下一階段上線。', 'info');
}

window.startRound = function(itemId, roundId) {
    Swal.fire('提醒', '啟動投票功能正在開發中，將於後續開票中心模組上線。', 'info');
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
    document.getElementById('previewSeats').textContent = item.seats;
    document.getElementById('previewDistrictReq').textContent = item.require_district ? ' (強制分區)' : '';

    // 渲染候選人清單
    const listContainer = document.getElementById('previewCandidatesList');
    listContainer.innerHTML = '';
    
    if (!round.candidate_ids || round.candidate_ids.length === 0) {
        listContainer.innerHTML = '<p class="text-center text-muted">此輪次目前沒有任何候選人。</p>';
    } else {
        // 從全域抓資料並過濾掉不可被選者
        let roundCandidates = allCandidates.filter(c => round.candidate_ids.includes(c.id) && !c.is_ineligible);
        
        // 判斷是否有共識薦選保留候選
        let forcedCandidate = null;
        if (item.forced_candidate_id) {
            const fIdx = roundCandidates.findIndex(c => c.id === item.forced_candidate_id);
            if (fIdx > -1) {
                forcedCandidate = roundCandidates[fIdx];
                // 將他從一般清單中移出
                roundCandidates.splice(fIdx, 1);
            }
        }
        
        roundCandidates.sort((a, b) => (parseInt(a.number)||0) - (parseInt(b.number)||0));
        
        if (forcedCandidate) {
            const districtStr = forcedCandidate.district ? `<small class="text-muted d-block">${forcedCandidate.district}</small>` : '';
            listContainer.innerHTML += `
                <div class="col-12 mb-4">
                    <div class="p-3 rounded" style="background-color: #fff3cd; border: 2px solid #ffecb5;">
                        <h6 class="fw-bold text-warning mb-3"><i class="fas fa-star"></i> 共識薦選保留候選 (保障名額 1 名)</h6>
                        <div class="row">
                            <div class="col-6 col-md-4">
                                <div class="bg-white border rounded p-3 text-center position-relative h-100 shadow-sm">
                                    <div style="position:absolute; top:10px; right:10px; width:20px; height:20px; border:2px solid #ccc; border-radius:3px;"></div>
                                    <h4 class="mb-0 fw-bold">${forcedCandidate.number}</h4>
                                    <h5 class="mb-0 mt-2">${forcedCandidate.name}</h5>
                                    ${districtStr}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-12 mb-2"><h6 class="fw-bold border-bottom pb-2">一般競選區 (應選 ${item.seats - 1} 名)</h6></div>
            `;
        }

        if (roundCandidates.length === 0 && !forcedCandidate) {
             listContainer.innerHTML = '<p class="text-center text-muted">此輪次的名單皆為不可被選狀態。</p>';
        }

        roundCandidates.forEach(c => {
            const districtStr = c.district ? `<small class="text-muted d-block">${c.district}</small>` : '';
            listContainer.innerHTML += `
                <div class="col-6 col-md-4 mb-3">
                    <div class="border rounded p-3 text-center position-relative h-100">
                        <div style="position:absolute; top:10px; right:10px; width:20px; height:20px; border:2px solid #ccc; border-radius:3px;"></div>
                        <h4 class="mb-0 fw-bold">${c.number}</h4>
                        <h5 class="mb-0 mt-2">${c.name}</h5>
                        ${districtStr}
                    </div>
                </div>
            `;
        });
    }

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
