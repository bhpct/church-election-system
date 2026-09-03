// voter.js

let currentElectionId = null;
let currentKeyCode = null;
let currentKeyDoc = null;

let electionData = null;
let itemData = null;
let roundData = null;
let candidatesMap = {}; // 允許投票的候選人
let unsubscribeRound = null;

// DOM Elements
const views = ['view-auth', 'view-ballot', 'view-waiting'];

document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    currentElectionId = urlParams.get('eid');
    const urlKey = urlParams.get('key');

    if (urlKey) {
        document.getElementById('keyInput').value = urlKey;
    }

    // 事件綁定
    document.getElementById('btnVerifyKey')?.addEventListener('click', handleVerifyKey);
    document.getElementById('btnSubmitVote')?.addEventListener('click', handleSubmitVote);

    // 關閉 Loader (移至 switchView 處理，避免白畫面)
    // document.getElementById('loader').style.display = 'none';
    
    // 如果 URL 有提供 EID 和 KEY，自動驗證
    if (currentElectionId && urlKey) {
        handleVerifyKey();
    } else {
        switchView('view-auth');
    }
});

function switchView(viewId) {
    document.getElementById('loader').style.display = 'none';
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) el.classList.remove('active');
    });
    const targetEl = document.getElementById(viewId);
    if (targetEl) targetEl.classList.add('active');
}

// 驗證金鑰
async function handleVerifyKey() {
    const keyInput = document.getElementById('keyInput').value.trim();
    if (!keyInput || keyInput.length !== 8) {
        Swal.fire('錯誤', '請輸入完整的 8 碼數字金鑰', 'error');
        return;
    }

    if (!currentElectionId) {
        Swal.fire('錯誤', '無效的選舉場次，請透過正式掃描連結進入', 'error');
        return;
    }

    const btn = document.getElementById('btnVerifyKey');
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 驗證中...';

        const { collection, query, where, getDocs, doc, getDoc } = window.fs;
        const db = window.firebaseDb;

        // 1. 驗證金鑰
        const keysRef = collection(db, 'elections', currentElectionId, 'keys');
        const q = query(keysRef, where('code', '==', keyInput));
        const snap = await getDocs(q);

        if (snap.empty) {
            throw new Error("找不到此金鑰，請確認輸入是否正確。");
        }

        currentKeyDoc = snap.docs[0];
        const keyData = currentKeyDoc.data();

        if (keyData.status === 'INVALID') throw new Error("此金鑰已被作廢。");
        if (keyData.status === 'USED') {
            Swal.fire({
                title: '金鑰已完成投票',
                text: '此金鑰已經使用過，不可重複投票。即將為您自動跳轉至開票中心查看結果...',
                icon: 'info',
                timer: 4000,
                showConfirmButton: false,
                allowOutsideClick: false
            }).then(() => {
                window.location.href = `result.html?election_id=${currentElectionId}&item_id=${keyData.item_id}&round_id=${keyData.round_id}`;
            });
            return;
        }
        
        currentKeyCode = keyData.code;

        // 2. 驗證場次與輪次狀態
        const itemId = keyData.item_id;
        const roundId = keyData.round_id;

        const electionSnap = await getDoc(doc(db, 'elections', currentElectionId));
        if (!electionSnap.exists()) throw new Error("選舉場次不存在。");
        electionData = electionSnap.data();

        if (electionData.status !== 'ACTIVE') throw new Error("本場選舉尚未開放或已結束。");

        const itemSnap = await getDoc(doc(db, 'elections', currentElectionId, 'items', itemId));
        if (!itemSnap.exists()) throw new Error("選舉項次不存在。");
        itemData = { id: itemSnap.id, ...itemSnap.data() };

        const roundSnap = await getDoc(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', roundId));
        if (!roundSnap.exists()) throw new Error("選舉輪次不存在。");
        roundData = { id: roundSnap.id, ...roundSnap.data() };

        if (roundData.status === 'PENDING') throw new Error("此輪次尚未開放投票，請稍候。");
        if (roundData.status === 'CLOSED') throw new Error("此輪次已結束投票，正在開票中。");
        
        // 若已發布結果，先提示再跳轉到投影畫面 (給選民看響應式結果)
        if (roundData.status === 'PUBLISHED') {
            Swal.fire({
                title: '本輪投票已結束',
                text: '此輪次投票已結束且結果已發布，將為您跳轉至結果畫面。',
                icon: 'info',
                timer: 3000,
                timerProgressBar: true,
                confirmButtonText: '查看結果'
            }).then(() => {
                window.location.href = `result.html?election_id=${currentElectionId}&item_id=${itemId}&round_id=${roundId}`;
            });
            return; // 終止後續
        }

        // 3. 載入候選人資料
        await loadCandidatesForBallot(roundData.candidate_ids);

        // 4. 建立選票 UI 並切換視窗
        buildBallotUI();
        
        // 檢查是否需要顯示教學模式
        // 條件：目前這張選票是本次選舉「第一次被開啟投票的那一輪」，且該 QR Code 金鑰還未看過教學
        const isFirstEverRound = (electionData.first_active_round_id === roundId);

        if (isFirstEverRound && !localStorage.getItem(`tutorial_completed_${currentKeyCode}`)) {
            startTutorial();
        } else {
            switchView('view-ballot');
        }

    } catch (error) {
        console.error(error);
        Swal.fire('錯誤', error.message, 'error');
        // 若發生錯誤，退回認證頁面，避免卡在白畫面
        switchView('view-auth');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '進入投票 <i class="fas fa-arrow-right ms-1"></i>';
    }
}

// 載入該輪候選人
async function loadCandidatesForBallot(candidateIds) {
    if (!candidateIds || candidateIds.length === 0) return;
    
    const { collection, getDocs } = window.fs;
    const db = window.firebaseDb;

    candidatesMap = {};
    
    // 效能優化：一次性讀取所有候選人，避免 N+1 查詢瓶頸
    const candidatesRef = collection(db, 'elections', currentElectionId, 'candidates');
    const snaps = await getDocs(candidatesRef);

    snaps.forEach(snap => {
        if (candidateIds.includes(snap.id)) {
            candidatesMap[snap.id] = snap.data();
        }
    });
}

// 建立選票介面 (智慧下拉搜尋)
function buildBallotUI() {
    const roundNames = { 'round_1': '第一輪', 'round_2': '第二輪', 'round_3': '第三輪' };
    const rName = roundNames[roundData.id] || roundData.id;

    document.getElementById('ballotElectionName').textContent = electionData.name;
    document.getElementById('ballotItemRoundName').textContent = `${itemData.title} - ${rName}`;
    
    const quota = parseInt(roundData.seats !== undefined ? roundData.seats : itemData.seats) || 1;
    document.getElementById('ballotQuota').textContent = quota;
    
    // 取得當前輪次的有效分區配置 (優先使用輪次設定，否則使用全局設定)
    const activeDistricts = roundData.selected_districts || itemData.selected_districts;
    
    const container = document.getElementById('ballotSelectionsContainer');
    container.innerHTML = '';
    
    const districtRuleEl = document.getElementById('ballotDistrictRule');
    
    // 如果有分區限制，詳細列出各區應選名額
    if (itemData.require_district && activeDistricts) {
        let districtDetails = [];
        // 取得所有候選人中出現過的分區，藉此保留上傳時的自然排序
        const allDistrictsInOrder = [...new Set(Object.values(candidatesMap).map(c => c.district).filter(Boolean))];
        
        allDistrictsInOrder.forEach(dist => {
            if (activeDistricts[dist]) {
                districtDetails.push(`[${dist}] 應選 ${activeDistricts[dist]} 名`);
            }
        });

        if (districtDetails.length > 0) {
            districtRuleEl.innerHTML = `(含強制分區限制)<br><div class="text-secondary fw-normal mt-1 d-inline-block text-start">配置：<br>${districtDetails.join('<br>')}</div>`;
            districtRuleEl.style.display = 'block';
        } else {
            districtRuleEl.innerHTML = `(含強制分區限制)`;
            districtRuleEl.style.display = 'block';
        }
    } else {
        districtRuleEl.style.display = 'none';
    }

    // 判斷是否有保障名額
    const forcedId = itemData.forced_candidate_id;
    const forcedCand = forcedId ? candidatesMap[forcedId] : null;

    for (let i = 0; i < quota; i++) {
        let isForcedCell = (i === 0 && forcedCand);
        
        const box = document.createElement('div');
        box.className = 'candidate-search-box mb-3';
        box.innerHTML = `
            <label class="form-label text-muted fw-bold">圈選欄 ${i+1}</label>
            <div class="input-group has-validation">
                <span class="input-group-text bg-white"><i class="fas fa-search text-muted"></i></span>
                <input type="text" class="form-control form-control-lg candidate-search-input" placeholder="輸入號碼/姓名/分區搜尋...">
                <input type="hidden" class="ballot-vote-val" value="">
                <div class="invalid-feedback text-start fw-bold" style="font-size: 0.9rem;">
                    <i class="fas fa-exclamation-triangle"></i> 你尚未選取候選人
                </div>
            </div>
            <div class="candidate-dropdown"></div>
            <div class="selected-candidate align-items-center" style="display:none; margin-top: 10px;">
                <img src="" class="selected-photo rounded-circle border me-2" style="width:40px;height:40px;object-fit:cover;display:none;">
                <div class="text-start flex-grow-1">
                    <span class="badge bg-primary me-2 selected-num"></span>
                    <strong class="selected-name fs-5"></strong>
                    <small class="text-muted ms-1 selected-dist"></small>
                </div>
                <button class="btn btn-sm btn-outline-danger btn-clear-selection ms-auto"><i class="fas fa-times"></i></button>
            </div>
        `;
        
        // 綁定搜尋事件 (所有欄位都綁定)
        const inputEl = box.querySelector('.candidate-search-input');
        const dropdownEl = box.querySelector('.candidate-dropdown');
        const hiddenVal = box.querySelector('.ballot-vote-val');
        const selectedDiv = box.querySelector('.selected-candidate');
        const clearBtn = box.querySelector('.btn-clear-selection');
        
        // 如果是保留名額的格子，手動觸發選取效果
        if (isForcedCell) {
            box.querySelector('label').innerHTML += ' (共識薦選保留)';
            hiddenVal.value = forcedId;
            
            box.querySelector('.selected-num').textContent = forcedCand.number || '-';
            box.querySelector('.selected-name').textContent = forcedCand.name;
            box.querySelector('.selected-dist').textContent = (forcedCand.district || '') + ' ' + (forcedCand.unit || '');
            
            const imgEl = box.querySelector('.selected-photo');
            if (forcedCand.photo_base64) {
                imgEl.src = forcedCand.photo_base64;
                imgEl.style.display = 'block';
            }
            
            inputEl.parentElement.style.display = 'none';
            selectedDiv.style.display = 'flex';
            selectedDiv.classList.add('border-warning', 'bg-light');
            const badge = box.querySelector('.selected-num');
            badge.classList.remove('bg-primary');
            badge.classList.add('bg-warning', 'text-dark');
            badge.textContent = '保障';
        }

        inputEl.addEventListener('focus', () => renderDropdown(inputEl, dropdownEl, forcedId, isForcedCell));
        inputEl.addEventListener('input', () => {
            inputEl.classList.remove('is-invalid');
            renderDropdown(inputEl, dropdownEl, forcedId, isForcedCell);
        });
        
        // 點擊外部關閉選單 (支援手機 touch 事件)
        const closeDropdown = (e) => {
            if (!box.contains(e.target)) {
                dropdownEl.style.display = 'none';
                if (!hiddenVal.value && inputEl.value.trim() !== '') {
                    inputEl.classList.add('is-invalid');
                } else {
                    inputEl.classList.remove('is-invalid');
                }
            }
        };
        document.addEventListener('click', closeDropdown);
        document.addEventListener('touchstart', closeDropdown, {passive: true});

        clearBtn.addEventListener('click', () => {
            hiddenVal.value = '';
            selectedDiv.style.display = 'none';
            inputEl.parentElement.style.display = 'flex';
            inputEl.value = '';
            inputEl.classList.remove('is-invalid');
            inputEl.focus();
            
            // 如果是取消保留名額，更新 UI 樣式
            if (isForcedCell) {
                selectedDiv.classList.remove('border-warning', 'bg-light');
                const badge = selectedDiv.querySelector('.selected-num');
                if(badge) {
                    badge.classList.remove('bg-warning', 'text-dark');
                    badge.classList.add('bg-primary');
                    badge.textContent = '-'; // 清除"保障"字樣
                }
            }
        });
        
        container.appendChild(box);
    }
}

function renderDropdown(inputEl, dropdownEl, forcedId, isForcedCell = false) {
    // 攔截全形數字並轉換為半形 (解決 iOS 鍵盤常自動輸入全形數字導致找不到人的問題)
    const rawVal = inputEl.value.trim();
    const halfWidthVal = rawVal.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248));
    const keyword = halfWidthVal.toLowerCase();
    dropdownEl.innerHTML = '';
    
    // 取得目前所有已選擇的 ID (除了自己)
    const allSelectedVals = Array.from(document.querySelectorAll('.ballot-vote-val')).map(el => el.value).filter(v => v !== '');

    // 取得當前輪次的有效分區配置
    const activeDistricts = roundData.selected_districts || itemData.selected_districts;

    // 取得已被選走的分區與其計數 (僅當啟動強制分區時)
    const selectedDistrictsCount = {};
    if (itemData.require_district && activeDistricts) {
        allSelectedVals.forEach(cid => {
            if (cid !== forcedId && candidatesMap[cid] && candidatesMap[cid].district) {
                const dist = candidatesMap[cid].district;
                selectedDistrictsCount[dist] = (selectedDistrictsCount[dist] || 0) + 1;
            }
        });
    }

    let matchCount = 0;

    // 依照 roundData.candidate_ids 的順序顯示 (此順序在晉級時已由系統依照得票數排序過)
    roundData.candidate_ids.forEach(cid => {
        if (isForcedCell) {
            if (cid !== forcedId) return; // 保留專屬格：只能選保留名額，其他人都不出現
        } else {
            if (cid === forcedId) return; // 一般格：排除保障名額
        }
        
        const c = candidatesMap[cid];
        if (!c) return;
        
        const rawSearchStr = `${c.number || ''} ${c.name} ${c.district || ''} ${c.unit || ''}`;
        const searchStr = rawSearchStr.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248)).toLowerCase();
        
        if (keyword === '' || searchStr.includes(keyword)) {
            const isAlreadySelected = allSelectedVals.includes(cid);
            if (isAlreadySelected) return; // 防呆：已選擇的候選人直接從其他選單消失
            
            // 防呆：如果該分區已達應選上限，則從選單消失 (保留專屬格不受此限)
            if (!isForcedCell && itemData.require_district && activeDistricts && c.district) {
                const limit = activeDistricts[c.district] || 1; // 容錯，預設1
                const currentCount = selectedDistrictsCount[c.district] || 0;
                if (currentCount >= limit) {
                    return;
                }
            }
            
            const photoHtml = c.photo_base64 ? `<img src="${c.photo_base64}" class="rounded-circle border me-2" style="width:35px;height:35px;object-fit:cover;">` : `<div class="rounded-circle border bg-light d-flex align-items-center justify-content-center text-muted me-2" style="width:35px;height:35px;font-size:0.8rem;"><i class="fas fa-user"></i></div>`;
            
            const div = document.createElement('div');
            div.className = `candidate-item d-flex align-items-center`;
            div.innerHTML = `
                ${photoHtml}
                <div class="text-start flex-grow-1">
                    <span class="badge bg-secondary me-2">${c.number || '-'}</span>
                    <strong>${c.name}</strong>
                    <small class="text-muted ms-2">${c.district || ''} ${c.unit || ''}</small>
                </div>
            `;
            
            div.addEventListener('click', () => {
                    const box = inputEl.closest('.candidate-search-box');
                    box.querySelector('.ballot-vote-val').value = cid;
                    box.querySelector('.selected-num').textContent = c.number || '-';
                    box.querySelector('.selected-name').textContent = c.name;
                    box.querySelector('.selected-dist').textContent = (c.district || '') + ' ' + (c.unit || '');
                    
                    const imgEl = box.querySelector('.selected-photo');
                    if (c.photo_base64) {
                        imgEl.src = c.photo_base64;
                        imgEl.style.display = 'block';
                    } else {
                        imgEl.src = '';
                        imgEl.style.display = 'none';
                    }
                    
                    inputEl.parentElement.style.display = 'none';
                    box.querySelector('.selected-candidate').style.display = 'flex';
                    dropdownEl.style.display = 'none';
                    
                    // 若為保留名額專屬格，恢復黃色徽章樣式
                    if (isForcedCell) {
                        const selectedDiv = box.querySelector('.selected-candidate');
                        selectedDiv.classList.add('border-warning', 'bg-light');
                        const badge = box.querySelector('.selected-num');
                        badge.classList.remove('bg-primary', 'bg-secondary');
                        badge.classList.add('bg-warning', 'text-dark');
                        badge.textContent = '保障';
                    } else {
                        // 若為一般格，確保是藍色樣式
                        const selectedDiv = box.querySelector('.selected-candidate');
                        selectedDiv.classList.remove('border-warning', 'bg-light');
                        const badge = box.querySelector('.selected-num');
                        badge.classList.remove('bg-warning', 'text-dark', 'bg-secondary');
                        badge.classList.add('bg-primary');
                    }
                });
            
            dropdownEl.appendChild(div);
            matchCount++;
        }
    });

    if (matchCount === 0) {
        dropdownEl.innerHTML = '<div class="p-3 text-muted text-center">找不到符合的候選人</div>';
    }

    dropdownEl.style.display = 'block';
}

// 提交選票
async function handleSubmitVote() {
    // 收集所有選擇
    const selectedIds = [];
    document.querySelectorAll('.ballot-vote-val').forEach(el => {
        if (el.value) selectedIds.push(el.value);
    });
    // 允許投空白票 (全空)
    if (selectedIds.length === 0) {
        // 不阻擋，允許送出空白票
    }

    // 取得當前輪次的有效分區配置
    const activeDistricts = roundData.selected_districts || itemData.selected_districts;

    // 驗證強制分區數量上限
    if (itemData.require_district && activeDistricts) {
        const selectedDistrictsCount = {};
        let districtConflict = false;
        let conflictMsg = '';
        const forcedId = itemData.forced_candidate_id; // 取得保留名額 ID
        
        for (const cid of selectedIds) {
            if (cid === forcedId) continue; // 保留名額不占用分區席次
            
            const dist = candidatesMap[cid]?.district;
            if (dist) {
                selectedDistrictsCount[dist] = (selectedDistrictsCount[dist] || 0) + 1;
                const limit = activeDistricts[dist] || 1;
                if (selectedDistrictsCount[dist] > limit) {
                    districtConflict = true;
                    conflictMsg = `【${dist}】已超過應選人數上限 (${limit}名)！`;
                    break;
                }
            }
        }
        
        if (districtConflict) {
            Swal.fire('分區限制衝突', `此項次要求強制分區限制，您圈選的候選人中：<br><br><span class="text-danger fw-bold">${conflictMsg}</span>`, 'error');
            return;
        }
    }

    // 確認視窗
    let confirmHtml = '';
    if (selectedIds.length === 0) {
        confirmHtml = `
            <div class="p-4 bg-danger text-white rounded mb-3 border border-4 border-dark shadow">
                <h2 class="m-0 fw-bold"><i class="fas fa-exclamation-triangle"></i> 空白票警告</h2>
                <p class="m-0 mt-2 fs-5">您沒有圈選任何候選人！<br>此選票將以「空白票」送出！</p>
            </div>
            <span class="text-danger fw-bold fs-5">送出後金鑰即失效，無法修改！</span>
        `;
    } else {
        const namesHtml = selectedIds.map((cid, idx) => {
            const c = candidatesMap[cid];
            return `<div class="text-start bg-light p-2 mb-1 border rounded fs-5">
                <span class="badge bg-secondary me-2">${c.number || '-'}</span> <strong>${c.name}</strong> <small class="text-muted">${c.district || ''} ${c.unit || ''}</small>
            </div>`;
        }).join('');
        confirmHtml = `
            <h4 class="mb-3">您共圈選了 <strong><span class="text-primary fs-3">${selectedIds.length}</span></strong> 位候選人：</h4>
            <div style="max-height: 250px; overflow-y: auto;" class="mb-4">${namesHtml}</div>
            <span class="text-danger fw-bold fs-5">送出後金鑰即失效，無法修改！</span>
        `;
    }

    const confirmResult = await Swal.fire({
        title: '確認送出選票？',
        html: confirmHtml,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '確定送出',
        cancelButtonText: '返回修改',
        confirmButtonColor: '#198754'
    });

    if (!confirmResult.isConfirmed) return;

    const btn = document.getElementById('btnSubmitVote');
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 寫入選票中...';

        const { writeBatch, doc, collection, serverTimestamp, getDoc } = window.fs;
        const db = window.firebaseDb;

        // Transaction/Batch 處理
        // 為了極致安全，最好用 runTransaction 再次確認 Key 狀態，但這裡用 Batch 搭配前端再次讀取
        const keyRef = doc(db, 'elections', currentElectionId, 'keys', currentKeyDoc.id);
        const latestKeySnap = await getDoc(keyRef);
        if (latestKeySnap.data().status !== 'VALID') {
            throw new Error("金鑰狀態已變更 (可能已在其他裝置送出)。");
        }

        const batch = writeBatch(db);
        const voteRef = doc(collection(db, 'elections', currentElectionId, 'votes'));

        batch.set(voteRef, {
            item_id: itemData.id,
            round_id: roundData.id,
            candidate_ids: selectedIds,
            created_at: serverTimestamp()
        });

        batch.update(keyRef, {
            status: 'USED',
            used_at: serverTimestamp(),
            vote_ref: voteRef.id
        });

        await batch.commit();

        // 成功！直接跳轉到 result.html 頁面
        window.location.href = `result.html?election_id=${currentElectionId}&item_id=${itemData.id}&round_id=${roundData.id}`;

    } catch (error) {
        console.error(error);
        Swal.fire('寫入失敗', error.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> 確認送出選票';
    }
}

// 監聽輪次狀態 (等候大廳即時開票板)
function listenToRoundResult() {
    const { doc, onSnapshot } = window.fs;
    const db = window.firebaseDb;
    const roundRef = doc(db, 'elections', currentElectionId, 'items', itemData.id, 'rounds', roundData.id);

    unsubscribeRound = onSnapshot(roundRef, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        
        if (data.status === 'PUBLISHED') {
            document.getElementById('waitStatusIcon').innerHTML = '<i class="fas fa-bullhorn text-warning" style="font-size: 5rem;"></i>';
            document.getElementById('waitTitle').textContent = '開票結果已發布！';
            document.getElementById('waitTitle').className = 'fw-bold text-warning mb-2';
            document.getElementById('waitSubtitle').textContent = '本輪次投票與開票已正式完成。';
            document.getElementById('waitSpinner').style.display = 'none';
            
            // 繪製結果
            const resultList = document.getElementById('liveResultList');
            resultList.innerHTML = '';
            
            if (data.elected_ids && data.elected_ids.length > 0) {
                data.elected_ids.forEach(cid => {
                    // 若前端 map 裡面有就直接用，若沒有可能需要重新拿。此處簡化處理，通常是剛剛那批名單。
                    const c = candidatesMap[cid]; 
                    if (c) {
                        resultList.innerHTML += `
                        <div class="list-group-item list-group-item-success d-flex justify-content-between align-items-center">
                            <div>
                                <span class="badge bg-success me-2">當選</span>
                                <strong>${c.name}</strong> <small class="text-muted">(${c.number || '-'})</small>
                            </div>
                        </div>`;
                    }
                });
            } else {
                resultList.innerHTML = '<div class="list-group-item text-muted">本輪無人達標當選</div>';
            }
            
            document.getElementById('liveResultSection').style.display = 'block';
            
            // 結束監聽
            if (unsubscribeRound) unsubscribeRound();
        }
    });
}

// 驗票反查機制

// ==========================================
// �оǼҦ� (Tutorial Mode)
// ==========================================
function startTutorial() {
    const overlay = document.getElementById('tutorialOverlay');
    const searchInput = document.getElementById('tutorialSearchInput');
    const candidateList = document.getElementById('tutorialCandidateList');
    const candidateCard = document.getElementById('tutorialCandidateCard');
    const successMsg = document.getElementById('tutorialSuccess');
    const searchGroup = document.getElementById('tutorialSearchGroup');
    const tutorialMsg = document.getElementById('tutorialMsg');

    // Reset state
    overlay.style.display = 'flex';
    searchInput.value = '';
    candidateList.style.display = 'none';
    successMsg.style.display = 'none';
    searchGroup.style.display = 'flex';
    tutorialMsg.style.display = 'block';

    // Step 1: Listen for any input
    const handleInput = () => {
        if (searchInput.value.trim().length > 0) {
            candidateList.style.display = 'block';
        } else {
            candidateList.style.display = 'none';
        }
    };
    searchInput.addEventListener('input', handleInput);

    // Step 2: Listen for click on dummy candidate
    const handleCardClick = () => {
        // Remove listeners
        searchInput.removeEventListener('input', handleInput);
        candidateCard.removeEventListener('click', handleCardClick);

        // Hide search UI, show success
        candidateList.style.display = 'none';
        searchGroup.style.display = 'none';
        tutorialMsg.style.display = 'none';
        successMsg.style.display = 'block';

        // Wait 3 seconds, then close tutorial and enter ballot
        setTimeout(() => {
            overlay.style.display = 'none';
            localStorage.setItem(`tutorial_completed_${currentKeyCode}`, 'true');
            switchView('view-ballot');
        }, 3000);
    };
    candidateCard.addEventListener('click', handleCardClick);
}
