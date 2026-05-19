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
const views = ['view-auth', 'view-ballot', 'view-waiting', 'view-audit'];

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
    document.getElementById('btnGoToAudit')?.addEventListener('click', () => switchView('view-audit'));
    document.getElementById('btnBackToAuth')?.addEventListener('click', () => switchView('view-auth'));
    document.getElementById('btnAuditSearch')?.addEventListener('click', handleAuditSearch);

    // 關閉 Loader
    document.getElementById('loader').style.display = 'none';
    
    // 如果 URL 有提供 EID 和 KEY，自動驗證
    if (currentElectionId && urlKey) {
        handleVerifyKey();
    } else {
        switchView('view-auth');
    }
});

function switchView(viewId) {
    views.forEach(v => {
        document.getElementById(v).classList.remove('active');
    });
    document.getElementById(viewId).classList.add('active');
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
        
        // 若已發布結果，直接跳轉到投影畫面 (給選民看響應式結果)
        if (roundData.status === 'PUBLISHED') {
            window.location.href = `result.html?election_id=${currentElectionId}&item_id=${itemId}&round_id=${roundId}`;
            return; // 終止後續
        }

        // 3. 載入候選人資料
        await loadCandidatesForBallot(roundData.candidate_ids);

        // 4. 建立選票 UI 並切換視窗
        buildBallotUI();
        switchView('view-ballot');

    } catch (error) {
        console.error(error);
        Swal.fire('錯誤', error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '進入投票 <i class="fas fa-arrow-right ms-1"></i>';
    }
}

// 載入該輪候選人
async function loadCandidatesForBallot(candidateIds) {
    if (!candidateIds || candidateIds.length === 0) return;
    
    const { doc, getDoc } = window.fs;
    const db = window.firebaseDb;

    candidatesMap = {};
    
    // 雖然可以批次，但候選人清單通常不會上千，這裡採 Promise.all 並行讀取
    const promises = candidateIds.map(cid => getDoc(doc(db, 'elections', currentElectionId, 'candidates', cid)));
    const snaps = await Promise.all(promises);

    snaps.forEach(snap => {
        if (snap.exists()) {
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
    
    const quota = parseInt(itemData.seats) || 1;
    document.getElementById('ballotQuota').textContent = quota;
    
    const districtRuleEl = document.getElementById('ballotDistrictRule');
    if (itemData.district_req) {
        districtRuleEl.style.display = 'block';
    } else {
        districtRuleEl.style.display = 'none';
    }

    const container = document.getElementById('ballotSelectionsContainer');
    container.innerHTML = '';

    // 判斷是否有保障名額
    const forcedId = itemData.forced_candidate_id;
    const forcedCand = forcedId ? candidatesMap[forcedId] : null;

    for (let i = 0; i < quota; i++) {
        let isForcedCell = (i === 0 && forcedCand);
        
        const box = document.createElement('div');
        box.className = 'candidate-search-box mb-3';
        
        if (isForcedCell) {
            box.innerHTML = `
                <label class="form-label text-muted fw-bold">圈選欄 ${i+1} (共識薦選保留)</label>
                <div class="selected-candidate border-warning bg-light">
                    <div>
                        <span class="badge bg-warning text-dark me-2">保障</span>
                        <strong>${forcedCand.number || ''} ${forcedCand.name}</strong>
                        <small class="text-muted ms-1">${forcedCand.district || ''}</small>
                    </div>
                </div>
                <input type="hidden" class="ballot-vote-val" value="${forcedId}">
            `;
        } else {
            box.innerHTML = `
                <label class="form-label text-muted fw-bold">圈選欄 ${i+1}</label>
                <div class="input-group">
                    <span class="input-group-text bg-white"><i class="fas fa-search text-muted"></i></span>
                    <input type="text" class="form-control form-control-lg candidate-search-input" placeholder="輸入號碼/姓名/分區搜尋...">
                    <input type="hidden" class="ballot-vote-val" value="">
                </div>
                <div class="candidate-dropdown"></div>
                <div class="selected-candidate" style="display:none; margin-top: 10px;">
                    <div>
                        <span class="badge bg-primary me-2 selected-num"></span>
                        <strong class="selected-name fs-5"></strong>
                        <small class="text-muted ms-1 selected-dist"></small>
                    </div>
                    <button class="btn btn-sm btn-outline-danger btn-clear-selection"><i class="fas fa-times"></i></button>
                </div>
            `;
            
            // 綁定搜尋事件
            const inputEl = box.querySelector('.candidate-search-input');
            const dropdownEl = box.querySelector('.candidate-dropdown');
            const hiddenVal = box.querySelector('.ballot-vote-val');
            const selectedDiv = box.querySelector('.selected-candidate');
            const clearBtn = box.querySelector('.btn-clear-selection');

            inputEl.addEventListener('focus', () => renderDropdown(inputEl, dropdownEl, forcedId));
            inputEl.addEventListener('input', () => renderDropdown(inputEl, dropdownEl, forcedId));
            
            // 點擊外部關閉選單
            document.addEventListener('click', (e) => {
                if (!box.contains(e.target)) dropdownEl.style.display = 'none';
            });

            clearBtn.addEventListener('click', () => {
                hiddenVal.value = '';
                selectedDiv.style.display = 'none';
                inputEl.parentElement.style.display = 'flex';
                inputEl.value = '';
                inputEl.focus();
            });
        }
        
        container.appendChild(box);
    }
}

function renderDropdown(inputEl, dropdownEl, forcedId) {
    const keyword = inputEl.value.trim().toLowerCase();
    dropdownEl.innerHTML = '';
    
    // 取得目前所有已選擇的 ID (除了自己)
    const allSelectedVals = Array.from(document.querySelectorAll('.ballot-vote-val')).map(el => el.value);

    let matchCount = 0;

    Object.keys(candidatesMap).forEach(cid => {
        if (cid === forcedId) return; // 排除保障名額
        
        const c = candidatesMap[cid];
        const searchStr = `${c.number || ''} ${c.name} ${c.district || ''} ${c.unit || ''}`.toLowerCase();
        
        if (keyword === '' || searchStr.includes(keyword)) {
            const isAlreadySelected = allSelectedVals.includes(cid);
            if (isAlreadySelected) return; // 防呆：已選擇的候選人直接從其他選單消失
            
            const div = document.createElement('div');
            div.className = `candidate-item`;
            div.innerHTML = `
                <div>
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
                    box.querySelector('.selected-dist').textContent = c.district || '';
                    
                    inputEl.parentElement.style.display = 'none';
                    box.querySelector('.selected-candidate').style.display = 'flex';
                    dropdownEl.style.display = 'none';
                });
            }
            
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

    // 驗證強制分區
    if (itemData.district_req) {
        const selectedDistricts = new Set();
        let districtConflict = false;
        
        for (const cid of selectedIds) {
            const dist = candidatesMap[cid]?.district;
            if (dist) {
                if (selectedDistricts.has(dist)) {
                    districtConflict = true;
                    break;
                }
                selectedDistricts.add(dist);
            }
        }
        
        if (districtConflict) {
            Swal.fire('分區限制衝突', '此項次要求【強制分區限制】，您不可圈選兩位以上來自同一分區的候選人！', 'error');
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
                <span class="badge bg-secondary me-2">${c.number || '-'}</span> <strong>${c.name}</strong> <small class="text-muted">${c.district || ''}</small>
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
async function handleAuditSearch() {
    const keyInput = document.getElementById('auditKeyInput').value.trim();
    if (!keyInput || keyInput.length !== 8) {
        Swal.fire('錯誤', '請輸入完整的 8 碼數字金鑰', 'error');
        return;
    }

    if (!currentElectionId) {
        Swal.fire('錯誤', '缺少選舉 EID 參數，無法反查。', 'error');
        return;
    }

    const btn = document.getElementById('btnAuditSearch');
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        const { collection, query, where, getDocs, doc, getDoc } = window.fs;
        const db = window.firebaseDb;

        const keysRef = collection(db, 'elections', currentElectionId, 'keys');
        const q = query(keysRef, where('code', '==', keyInput));
        const snap = await getDocs(q);

        if (snap.empty) {
            throw new Error("找不到此金鑰紀錄。");
        }

        const keyData = snap.docs[0].data();
        if (keyData.status !== 'USED' || !keyData.vote_ref) {
            throw new Error("此金鑰尚未使用，或無投票紀錄。");
        }

        // 查詢 vote 紀錄
        const voteSnap = await getDoc(doc(db, 'elections', currentElectionId, 'votes', keyData.vote_ref));
        if (!voteSnap.exists()) {
            throw new Error("無法讀取選票紀錄 (可能遺失或權限不足)。");
        }

        const voteData = voteSnap.data();
        const candidateIds = voteData.candidate_ids || [];

        // 查詢候選人名稱
        const ul = document.getElementById('auditVoteList');
        ul.innerHTML = '';
        
        for (const cid of candidateIds) {
            const candSnap = await getDoc(doc(db, 'elections', currentElectionId, 'candidates', cid));
            if (candSnap.exists()) {
                const c = candSnap.data();
                ul.innerHTML += `<li><strong>${c.number || '-'}</strong> ${c.name} <small class="text-muted">(${c.district || ''})</small></li>`;
            } else {
                ul.innerHTML += `<li>未知候選人 (ID: ${cid})</li>`;
            }
        }

        document.getElementById('auditResult').style.display = 'block';

    } catch (error) {
        console.error(error);
        document.getElementById('auditResult').style.display = 'none';
        Swal.fire('查詢失敗', error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '查詢';
    }
}
