// voter.js

let currentElectionId = null;
let currentKeyCode = null;
let currentKeyDoc = null;

let electionData = null;
let itemData = null;
let roundData = null;
let candidatesMap = {}; // 允許投票的候選人
let allElectionCandidatesMap = {}; // 全場候選人資料庫名單 (用於新手練習模式)
let unsubscribeRound = null;

let unsubscribeElection = null;
let isCurrentInTutorialMode = false;
let hasSubmittedVote = false;

// DOM Elements
const views = ['view-auth', 'view-ballot', 'view-waiting', 'view-pending-vote'];

function getRoundName(rId) {
    const roundNames = { 'round_1': '第一輪', 'round_2': '第二輪', 'round_3': '第三輪' };
    return roundNames[rId] || rId;
}

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
    
    // 新手教學模擬送出按鈕事件 (完整模擬正式選票之送出確認、空白票警告與再練習一次)
    document.getElementById('btnTutorialSimulateSubmit')?.addEventListener('click', async () => {
        const slots = document.querySelectorAll('.ballot-slot-card');
        const selectedList = [];
        const chosenCandidates = [];

        slots.forEach((s, idx) => {
            const val = s.querySelector('.ballot-vote-val')?.value;
            const cand = val ? (candidatesMap[val] || allElectionCandidatesMap[val]) : null;
            if (cand) {
                chosenCandidates.push(cand);
                selectedList.push(`• 圈選欄 ${idx + 1}：<strong class="text-primary fs-6">${cand.name}</strong> <span class="badge bg-secondary">${cand.number || '-'}號</span> <small class="text-muted">(${cand.district || ''} ${cand.unit || ''})</small>`);
            } else {
                selectedList.push(`• 圈選欄 ${idx + 1}：<span class="text-danger fw-bold"><i class="fas fa-times-circle"></i> （未圈選 / 空白票）</span>`);
            }
        });

        const selectedCount = chosenCandidates.length;

        // 步驟 1: 完全比照正式投票之「送出確認」與「空白票警告」
        let confirmHtml = '';
        if (selectedCount === 0) {
            confirmHtml = `
                <div class="p-3 bg-danger text-white rounded mb-3 border border-3 border-dark shadow">
                    <h3 class="m-0 fw-bold"><i class="fas fa-exclamation-triangle"></i> 空白票警告（模擬練習）</h3>
                    <p class="m-0 mt-2 fs-6">您<strong>沒有圈選任何候選人</strong>！<br>在正式投票中，此選票將以「<strong>空白票</strong>」送出！</p>
                </div>
                <div class="alert alert-warning py-2 mb-2 small text-start border-warning" style="background-color: #fff3cd;">
                    <i class="fas fa-info-circle text-warning me-1"></i> <strong>教學提醒</strong>：在教會正式大會投票中，投空白票是合法的。但一旦確認送出，選票金鑰即失效，無法收回重投。
                </div>
                <span class="text-secondary small">此為模擬練習操作，未消耗金鑰，請選擇是否確認送出。</span>
            `;
        } else if (selectedCount < 2) {
            confirmHtml = `
                <div class="p-3 bg-warning text-dark rounded mb-3 border border-2 border-warning shadow-sm">
                    <h4 class="m-0 fw-bold text-dark"><i class="fas fa-info-circle"></i> 部分空白提示（模擬練習）</h4>
                    <p class="m-0 mt-2 fs-6">練習模式應選 2 位，您目前圈選了 <strong>${selectedCount}</strong> 位候選人，另一欄為<strong>空白票</strong>。</p>
                </div>
                <div class="text-start bg-light p-2 mb-2 border rounded fs-6">
                    ${chosenCandidates.map(c => `<div><span class="badge bg-primary me-2">${c.number || '-'}</span> <strong>${c.name}</strong> <small class="text-muted">(${c.district || ''} ${c.unit || ''})</small></div>`).join('')}
                </div>
                <span class="text-secondary small">此為模擬練習操作，未消耗金鑰，請選擇是否確認送出。</span>
            `;
        } else {
            const namesHtml = chosenCandidates.map(c => {
                return `<div class="text-start bg-light p-2 mb-1 border rounded fs-6">
                    <span class="badge bg-primary me-2">${c.number || '-'}</span> <strong>${c.name}</strong> <small class="text-muted">(${c.district || ''} ${c.unit || ''})</small>
                </div>`;
            }).join('');
            confirmHtml = `
                <h5 class="mb-3">您共模擬圈選了 <strong><span class="text-primary fs-4">${selectedCount}</span></strong> 位候選人：</h5>
                <div style="max-height: 200px; overflow-y: auto;" class="mb-3">${namesHtml}</div>
                <div class="alert alert-warning py-1 small text-start border-warning" style="background-color: #fff3cd;">
                    <i class="fas fa-exclamation-triangle text-danger me-1"></i> ⚠️ 練習中・非正式選舉，未消耗選票金鑰
                </div>
            `;
        }

        const confirmResult = await Swal.fire({
            title: selectedCount === 0 ? '⚠️ 空白票確認' : '確認送出選票？（模擬）',
            html: confirmHtml,
            icon: selectedCount === 0 ? 'warning' : 'question',
            showCancelButton: true,
            confirmButtonText: selectedCount === 0 ? '確定以空白票送出' : '確定送出',
            cancelButtonText: '返回修改',
            confirmButtonColor: selectedCount === 0 ? '#dc3545' : '#198754',
            cancelButtonColor: '#6c757d'
        });

        if (!confirmResult.isConfirmed) return;

        // 步驟 2: 模擬送出成功成果卡片（可選再練習一次或靜候正式投票）
        Swal.fire({
            title: selectedCount === 0 ? '🎉 空白票模擬送出完成！' : '🎉 模擬練習送出成功！',
            html: `
                <div class="alert alert-warning text-start small py-2 mb-3 border-warning" style="background-color: #fff3cd;">
                    <div class="fw-bold text-danger mb-1"><i class="fas fa-exclamation-triangle me-1"></i> 練習中・非正式選舉</div>
                    此為大會投票模擬操作練習，<strong>未消耗您的選票金鑰，亦不計入正式開票數據</strong>。
                </div>
                <div class="text-start p-3 bg-light rounded border mb-3 small">
                    <h6 class="fw-bold text-dark mb-2"><i class="fas fa-check-circle text-success me-1"></i> 您剛才模擬圈選的內容：</h6>
                    ${selectedList.join('<br>')}
                </div>
                <p class="text-muted small mb-0">您可以點擊「<b>再練習一次</b>」清空重新圈選，或點擊「<b>靜候正式投票</b>」等待主席宣布正式投票。</p>
            `,
            icon: 'success',
            showCancelButton: true,
            confirmButtonText: '<i class="fas fa-redo me-1"></i> 再練習一次',
            cancelButtonText: '<i class="fas fa-clock me-1"></i> 靜候正式投票',
            confirmButtonColor: '#0d6efd',
            cancelButtonColor: '#6c757d',
            allowOutsideClick: false
        }).then((result) => {
            if (result.isConfirmed) {
                // 再練習一次：清空選票重新建構練習介面
                buildBallotUI();
                Swal.fire({
                    toast: true,
                    position: 'top',
                    timer: 2000,
                    showConfirmButton: false,
                    icon: 'info',
                    title: '模擬選票已重置，您可以再次練習圈選！'
                });
            }
        });
    });

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
        electionData = { id: electionSnap.id, ...electionSnap.data() };

        if (electionData.status !== 'ACTIVE') throw new Error("本場選舉尚未開放或已結束。");

        const itemSnap = await getDoc(doc(db, 'elections', currentElectionId, 'items', itemId));
        if (!itemSnap.exists()) throw new Error("選舉項次不存在。");
        itemData = { id: itemSnap.id, ...itemSnap.data() };

        const roundSnap = await getDoc(doc(db, 'elections', currentElectionId, 'items', itemId, 'rounds', roundId));
        if (!roundSnap.exists()) throw new Error("選舉輪次不存在。");
        roundData = { id: roundSnap.id, ...roundSnap.data() };

        // 3. 載入候選人資料並建立選票 UI
        await loadCandidatesForBallot(roundData.candidate_ids);
        buildBallotUI();

        // 4. 啟動即時動態狀態監聽器 (監聽新手教學開關與輪次狀態)
        setupLiveStateListener(currentElectionId, itemId, roundId);

        // 5. 依據當前狀態刷新畫面
        refreshVoterState();

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

// 核心狀態機：依據新手教學開關與輪次狀態，無縫切換畫面
function refreshVoterState() {
    if (hasSubmittedVote) return;

    closePickersIfOpen();

    const isTutorialOn = (electionData && electionData.enable_tutorial === true);

    if (roundData.status === 'PUBLISHED') {
        Swal.fire({
            title: '本輪投票已結束',
            text: '此輪次投票已結束且結果已發布，將為您跳轉至結果畫面。',
            icon: 'info',
            timer: 3000,
            timerProgressBar: true,
            confirmButtonText: '查看結果'
        }).then(() => {
            window.location.href = `result.html?election_id=${currentElectionId}&item_id=${itemData.id}&round_id=${roundData.id}`;
        });
        return;
    }

    if (roundData.status === 'CLOSED') {
        Swal.fire({
            title: '本輪投票已截止',
            text: '主席已宣布結束投票，正在進行開票核算中。',
            icon: 'info',
            showConfirmButton: false,
            allowOutsideClick: false
        });
        return;
    }

    if (isTutorialOn) {
        // 新手教學開關開啟中：無論發放哪一輪、狀態是否 PENDING，一律進入教學練習模式！
        showTutorialMode(true);
        switchView('view-ballot');
    } else {
        // 新手教學關閉
        showTutorialMode(false);
        if (roundData.status === 'PENDING') {
            const rName = getRoundName(roundData.id);
            const el = document.getElementById('pendingItemRoundName');
            if (el) el.textContent = `${itemData.title} - ${rName}`;
            switchView('view-pending-vote');
        } else if (roundData.status === 'ACTIVE') {
            switchView('view-ballot');
        }
    }
}

// 切換教學模式 UI（說明條、按鈕模擬、退回練習時清空槽位）
function showTutorialMode(isTutorial) {
    const banner = document.getElementById('tutorialInstructionBanner');
    const submitBtn = document.getElementById('btnSubmitVote');
    const simBtn = document.getElementById('btnTutorialSimulateSubmit');

    if (isTutorial) {
        if (!isCurrentInTutorialMode) {
            isCurrentInTutorialMode = true;
            buildBallotUI();
        }
        if (banner) banner.style.display = 'block';
        if (submitBtn) submitBtn.style.display = 'none';
        if (simBtn) simBtn.style.display = 'block';
    } else {
        if (isCurrentInTutorialMode) {
            // 從教學練習模式切回正式狀態，清空練習時所點選的暫存內容，還原為正式選票
            isCurrentInTutorialMode = false;
            buildBallotUI();
        }
        if (banner) banner.style.display = 'none';
        if (submitBtn) submitBtn.style.display = 'block';
        if (simBtn) simBtn.style.display = 'none';
    }
}

// 關閉可能開啟中的選人抽屜或搜尋視窗
function closePickersIfOpen() {
    try {
        const offcanvasEl = document.getElementById('candidatePickerOffcanvas');
        if (offcanvasEl && window.bootstrap && window.bootstrap.Offcanvas) {
            const bsOffcanvas = window.bootstrap.Offcanvas.getInstance(offcanvasEl);
            if (bsOffcanvas) bsOffcanvas.hide();
        }
        const searchModalEl = document.getElementById('searchCandidateModal');
        if (searchModalEl && window.bootstrap && window.bootstrap.Modal) {
            const bsModal = window.bootstrap.Modal.getInstance(searchModalEl);
            if (bsModal) bsModal.hide();
        }
    } catch (e) {
        console.warn('關閉挑選彈窗時略過:', e);
    }
}

// 即時狀態監聽器
function setupLiveStateListener(electionId, itemId, roundId) {
    const { doc, onSnapshot } = window.fs;
    const db = window.firebaseDb;

    if (unsubscribeElection) unsubscribeElection();
    if (unsubscribeRound) unsubscribeRound();

    // 監聽選舉全域設定 (特別是 enable_tutorial 開關)
    const electionRef = doc(db, 'elections', electionId);
    unsubscribeElection = onSnapshot(electionRef, (snap) => {
        if (!snap.exists()) return;
        const eData = snap.data();
        const prevTutorial = electionData ? electionData.enable_tutorial : null;
        electionData = { ...electionData, ...eData };
        if (prevTutorial !== (eData.enable_tutorial === true)) {
            refreshVoterState();
        }
    });

    // 監聽該輪次之狀態 (PENDING -> ACTIVE -> CLOSED -> PUBLISHED)
    const roundRef = doc(db, 'elections', electionId, 'items', itemId, 'rounds', roundId);
    unsubscribeRound = onSnapshot(roundRef, async (snap) => {
        if (!snap.exists()) return;
        const rData = snap.data();
        const prevStatus = roundData ? roundData.status : null;
        roundData = { id: snap.id, ...rData };

        // 若候選人名單有異動，重新載入
        if (rData.candidate_ids && JSON.stringify(rData.candidate_ids) !== JSON.stringify(Object.keys(candidatesMap))) {
            await loadCandidatesForBallot(rData.candidate_ids);
            buildBallotUI();
        }

        if (prevStatus !== rData.status) {
            refreshVoterState();
        }
    });
}

// 載入該輪候選人與全場候選人資料庫名單
async function loadCandidatesForBallot(candidateIds) {
    const { collection, getDocs } = window.fs;
    const db = window.firebaseDb;

    candidatesMap = {};
    allElectionCandidatesMap = {};
    
    // 效能優化：一次性讀取所有候選人
    const candidatesRef = collection(db, 'elections', currentElectionId, 'candidates');
    const snaps = await getDocs(candidatesRef);

    const excludeElected = (itemData && itemData.exclude_elected !== false);

    snaps.forEach(snap => {
        const data = snap.data();
        if (data.is_ineligible) return; // 全域不可被選者直接排除

        // 全場候選人資料庫名單 (用於新手練習模式)
        allElectionCandidatesMap[snap.id] = { id: snap.id, ...data };

        // 正式輪次名單
        if (candidateIds && candidateIds.includes(snap.id)) {
            // 雙重防禦：若該項次設定排除已當選，且此人已在其他項次當選，則不列入選票名單
            if (excludeElected && data.elected_item && data.elected_item.trim() !== '' && data.elected_item !== itemData.title) {
                return;
            }
            candidatesMap[snap.id] = { id: snap.id, ...data };
        }
    });
}

// 全域變數以追蹤挑選器目前的目標圈選欄 (0-based)
let currentTargetSlotIndex = null;
let pickerOffcanvasInstance = null;
let searchModalInstance = null;
let searchModalInitialized = false;

// 建立選票介面 (卡片槽位 + 雙按鈕分流：瀏覽 vs 搜尋)
function buildBallotUI() {
    const isPractice = (isCurrentInTutorialMode === true);
    const quota = isPractice ? 2 : (parseInt(roundData.seats !== undefined ? roundData.seats : itemData.seats) || 1);

    const districtRuleEl = document.getElementById('ballotDistrictRule');

    if (isPractice) {
        document.getElementById('ballotElectionName').textContent = electionData.name;
        document.getElementById('ballotItemRoundName').innerHTML = `<span class="badge bg-danger text-white me-2 fs-6"><i class="fas fa-exclamation-triangle me-1"></i> 練習中・非正式選舉</span> ${itemData ? itemData.title : '選舉'} - 投票操作練習`;
        document.getElementById('ballotQuota').textContent = '2';
        if (districtRuleEl) {
            districtRuleEl.innerHTML = `<span class="badge bg-warning text-dark"><i class="fas fa-info-circle me-1"></i> 練習模式開放全體候選人自由練習，不設分區限制</span>`;
            districtRuleEl.style.display = 'block';
        }
    } else {
        const roundNames = { 'round_1': '第一輪', 'round_2': '第二輪', 'round_3': '第三輪' };
        const rName = roundNames[roundData.id] || roundData.id;

        document.getElementById('ballotElectionName').textContent = electionData.name;
        document.getElementById('ballotItemRoundName').textContent = `${itemData.title} - ${rName}`;
        document.getElementById('ballotQuota').textContent = quota;

        // 取得當前輪次的有效分區配置 (優先使用輪次設定，否則使用全局設定)
        const activeDistricts = roundData.selected_districts || itemData.selected_districts;
        
        // 如果有分區限制，詳細列出各區應選名額
        if (itemData.require_district && activeDistricts) {
            let districtDetails = [];
            const allDistrictsInOrder = [...new Set(Object.values(candidatesMap).map(c => c.district).filter(Boolean))];
            
            allDistrictsInOrder.forEach(dist => {
                const q = activeDistricts[dist] !== undefined ? parseInt(activeDistricts[dist]) : 0;
                if (q > 0) {
                    districtDetails.push(`[${dist}] 應選 ${q} 名`);
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
    }

    const container = document.getElementById('ballotSelectionsContainer');
    container.innerHTML = '';

    // 判斷是否有保障名額 (練習模式無保障名額限制)
    const forcedId = isPractice ? null : itemData.forced_candidate_id;
    const forcedCand = forcedId ? candidatesMap[forcedId] : null;

    // 初始化 Bootstrap Offcanvas 與 Modal 實例
    const offcanvasEl = document.getElementById('candidatePickerOffcanvas');
    if (offcanvasEl && window.bootstrap) {
        pickerOffcanvasInstance = bootstrap.Offcanvas.getOrCreateInstance(offcanvasEl);
    }
    const modalEl = document.getElementById('candidateSearchModal');
    if (modalEl && window.bootstrap) {
        searchModalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    }

    for (let i = 0; i < quota; i++) {
        const isForcedCell = (!isPractice && i === 0 && forcedCand);
        let practicePrompt = '';
        if (isPractice) {
            if (i === 0) practicePrompt = '<span class="badge bg-primary-subtle text-primary border ms-2">建議使用 [📋 瀏覽名單]</span>';
            if (i === 1) practicePrompt = '<span class="badge bg-success-subtle text-success border ms-2">建議使用 [🔍 快速搜尋]</span>';
        }

        const slotCard = document.createElement('div');
        slotCard.className = 'card mb-3 ballot-slot-card shadow-sm border';
        slotCard.id = `ballotSlotCard_${i}`;
        slotCard.dataset.slotIndex = i;

        slotCard.innerHTML = `
            <div class="card-body p-3">
                <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-1">
                    <span class="badge bg-secondary-subtle text-secondary border px-2 py-1 fs-6 slot-label">
                        圈選欄 ${i+1}${isForcedCell ? ' <span class="badge bg-warning text-dark ms-1">共識薦選保留</span>' : ''}${practicePrompt}
                    </span>
                    <span class="slot-status-badge text-muted small fw-bold">
                        ${isForcedCell ? '<i class="fas fa-lock text-warning"></i> 已保留' : (isPractice ? '尚未選擇 (練習中)' : '尚未圈選 (空白票)')}
                    </span>
                </div>
                
                <!-- 未選狀態 (Unselected) -->
                <div class="slot-unselected-box d-flex flex-wrap justify-content-between align-items-center p-3 rounded-3" style="${isForcedCell ? 'display: none !important;' : ''}">
                    <div class="text-secondary fw-bold mb-2 mb-sm-0 fs-6">
                        <i class="fas fa-circle-notch text-muted me-1"></i> 未選 / 空白
                    </div>
                    <div class="d-flex gap-2">
                        <button type="button" class="btn btn-primary px-3 py-2 fw-bold btn-slot-browse shadow-sm" data-slot="${i}">
                            <i class="fas fa-list-ul me-1"></i> 瀏覽名單
                        </button>
                        <button type="button" class="btn btn-outline-primary px-3 py-2 fw-bold btn-slot-search shadow-sm" data-slot="${i}">
                            <i class="fas fa-search me-1"></i> 快速搜尋
                        </button>
                    </div>
                </div>

                <!-- 已選狀態 (Selected) -->
                <div class="slot-selected-box align-items-center justify-content-between p-3 rounded-3" style="${isForcedCell ? 'display: flex;' : 'display: none;'} ${isForcedCell ? 'background: #fff9db !important; border-color: #ffc107 !important;' : ''}">
                    <div class="d-flex align-items-center flex-grow-1 overflow-hidden me-2">
                        <img src="${(isForcedCell && forcedCand && forcedCand.photo_base64) ? forcedCand.photo_base64 : ''}" 
                             class="slot-candidate-photo rounded-circle border me-3" 
                             style="width: 44px; height: 44px; object-fit: cover; ${isForcedCell && forcedCand && forcedCand.photo_base64 ? 'display: block;' : 'display: none;'}">
                        <div class="rounded-circle border bg-white d-flex align-items-center justify-content-center text-muted me-3 slot-candidate-placeholder" 
                             style="width: 44px; height: 44px; flex-shrink: 0; ${isForcedCell && forcedCand && forcedCand.photo_base64 ? 'display: none;' : 'display: flex;'}">
                            <i class="fas fa-user"></i>
                        </div>
                        <div class="text-truncate">
                            <div class="d-flex align-items-center">
                                <span class="badge ${isForcedCell ? 'bg-warning text-dark' : 'bg-primary'} me-2 slot-candidate-num fs-6">
                                    ${isForcedCell ? '保障' : (forcedCand ? forcedCand.number || '-' : '')}
                                </span>
                                <strong class="fs-5 slot-candidate-name text-dark">
                                    ${isForcedCell ? forcedCand.name : ''}
                                </strong>
                            </div>
                            <div class="small text-muted slot-candidate-dist text-truncate mt-1">
                                ${isForcedCell ? ((forcedCand.district || '') + ' ' + (forcedCand.unit || '')) : ''}
                            </div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-outline-danger btn-sm px-3 py-2 fw-bold btn-slot-clear" data-slot="${i}">
                        <i class="fas fa-times me-1"></i> 清除
                    </button>
                </div>
            </div>
            <input type="hidden" class="ballot-vote-val" value="${isForcedCell ? forcedId : ''}">
        `;

        // 綁定各按鈕事件
        slotCard.querySelector('.btn-slot-browse')?.addEventListener('click', () => openCandidatePicker(i));
        slotCard.querySelector('.btn-slot-search')?.addEventListener('click', () => openCandidateSearch(i));
        slotCard.querySelector('.btn-slot-clear')?.addEventListener('click', () => clearSlotCandidate(i));

        container.appendChild(slotCard);
    }

    // 初始化搜尋彈窗的即時監聽器
    initSearchModalListeners();
}

// 瀏覽名單挑選器 (Bottom Sheet - 100% 不叫出虛擬鍵盤，滑動流暢)
function openCandidatePicker(slotIndex) {
    currentTargetSlotIndex = slotIndex;
    const isPractice = (isCurrentInTutorialMode === true);
    const titleEl = document.getElementById('pickerOffcanvasTitle');
    if (titleEl) {
        if (isPractice) {
            titleEl.innerHTML = `<i class="fas fa-list-check me-2"></i>選擇練習候選人 (圈選欄 ${slotIndex + 1}) <span class="badge bg-danger ms-1">⚠️ 練習中</span>`;
        } else {
            titleEl.innerHTML = `<i class="fas fa-list-check me-2"></i>選擇候選人 (圈選欄 ${slotIndex + 1})`;
        }
    }

    const listContainer = document.getElementById('pickerCandidateList');
    listContainer.innerHTML = '';

    const forcedId = isPractice ? null : itemData.forced_candidate_id;
    const isForcedCell = (!isPractice && slotIndex === 0 && forcedId);

    // 取得目前所有已選擇的 ID (排除當前 slot)
    const currentSlots = document.querySelectorAll('.ballot-slot-card');
    const allSelectedVals = [];
    currentSlots.forEach((slot, idx) => {
        if (idx !== slotIndex) {
            const val = slot.querySelector('.ballot-vote-val')?.value;
            if (val) allSelectedVals.push(val);
        }
    });

    const activeDistricts = roundData.selected_districts || itemData.selected_districts;
    const selectedDistrictsCount = {};
    if (!isPractice && itemData.require_district && activeDistricts) {
        allSelectedVals.forEach(cid => {
            if (cid !== forcedId && candidatesMap[cid] && candidatesMap[cid].district) {
                const dist = candidatesMap[cid].district;
                selectedDistrictsCount[dist] = (selectedDistrictsCount[dist] || 0) + 1;
            }
        });
    }

    // 取得候選人清單：練習模式使用全場候選人資料庫名單，正式投票使用當前輪次名單
    let candidateList = [];
    if (isPractice) {
        candidateList = Object.values(allElectionCandidatesMap);
    } else {
        candidateList = (roundData.candidate_ids || [])
            .map(cid => candidatesMap[cid] ? { id: cid, ...candidatesMap[cid] } : null)
            .filter(Boolean);
    }

    // 依候選人號碼自然排序 (1, 2, 3... 10, 11...)
    candidateList.sort((a, b) => {
        return String(a.number || '').localeCompare(String(b.number || ''), 'zh-TW', { numeric: true });
    });

    let visibleCount = 0;
    candidateList.forEach(c => {
        const cid = c.id;
        if (!isPractice) {
            if (isForcedCell) {
                if (cid !== forcedId) return;
            } else {
                if (cid === forcedId) return;
            }

            // 分區限制過濾：若該分區應選配額 <= 0，且非保留名額，直接不在候選名單中出現！
            if (!isForcedCell && itemData.require_district && activeDistricts && c.district) {
                const distQuota = activeDistricts[c.district] !== undefined ? parseInt(activeDistricts[c.district]) : 0;
                if (distQuota <= 0) {
                    return; // 該分區名額為 0，不顯示
                }
            }
        }

        const isAlreadySelected = allSelectedVals.includes(cid);
        let isDistrictFull = false;
        if (!isPractice && !isForcedCell && itemData.require_district && activeDistricts && c.district) {
            const limit = activeDistricts[c.district] !== undefined ? parseInt(activeDistricts[c.district]) : 0;
            const currentCount = selectedDistrictsCount[c.district] || 0;
            if (currentCount >= limit) {
                isDistrictFull = true;
            }
        }

        const isDisabled = isAlreadySelected || isDistrictFull;
        let disabledReason = '';
        if (isAlreadySelected) disabledReason = '<span class="badge bg-secondary ms-auto">已在其他欄圈選</span>';
        else if (isDistrictFull) disabledReason = '<span class="badge bg-warning text-dark ms-auto">此區名額已滿</span>';

        const photoHtml = c.photo_base64 
            ? `<img src="${c.photo_base64}" class="rounded-circle border me-3" style="width: 44px; height: 44px; object-fit: cover;">`
            : `<div class="rounded-circle border bg-light d-flex align-items-center justify-content-center text-muted me-3" style="width: 44px; height: 44px; flex-shrink: 0;"><i class="fas fa-user"></i></div>`;

        const itemBtn = document.createElement('div');
        itemBtn.className = `offcanvas-candidate-item shadow-sm ${isDisabled ? 'disabled' : ''}`;
        itemBtn.innerHTML = `
            ${photoHtml}
            <div class="text-start flex-grow-1">
                <div class="d-flex align-items-center">
                    <span class="badge bg-primary me-2">${c.number || '-'}</span>
                    <strong class="fs-5 text-dark">${c.name}</strong>
                </div>
                <div class="small text-muted mt-1">${c.district || ''} ${c.unit || ''}</div>
            </div>
            ${disabledReason ? disabledReason : '<i class="fas fa-chevron-right text-muted ms-2"></i>'}
        `;

        if (!isDisabled) {
            itemBtn.addEventListener('click', () => {
                setSlotCandidate(currentTargetSlotIndex, cid);
                if (pickerOffcanvasInstance) pickerOffcanvasInstance.hide();
            });
        }

        listContainer.appendChild(itemBtn);
        visibleCount++;
    });

    if (visibleCount === 0) {
        listContainer.innerHTML = '<div class="p-4 text-center text-muted">無符合條件的候選人</div>';
    }

    if (pickerOffcanvasInstance) {
        pickerOffcanvasInstance.show();
    }
}

// 快速搜尋彈窗
function initSearchModalListeners() {
    if (searchModalInitialized) return;
    searchModalInitialized = true;

    const modalEl = document.getElementById('candidateSearchModal');
    const inputEl = document.getElementById('modalSearchInput');
    const clearBtn = document.getElementById('btnClearModalSearch');

    modalEl?.addEventListener('shown.bs.modal', () => {
        if (inputEl) {
            inputEl.value = '';
            inputEl.focus();
            renderSearchResults('');
        }
    });

    inputEl?.addEventListener('input', () => {
        renderSearchResults(inputEl.value);
    });

    clearBtn?.addEventListener('click', () => {
        if (inputEl) {
            inputEl.value = '';
            inputEl.focus();
            renderSearchResults('');
        }
    });
}

function openCandidateSearch(slotIndex) {
    currentTargetSlotIndex = slotIndex;
    const isPractice = (isCurrentInTutorialMode === true);
    const titleEl = document.getElementById('searchModalTitle');
    if (titleEl) {
        if (isPractice) {
            titleEl.innerHTML = `<i class="fas fa-search me-2"></i>搜尋練習候選人 (圈選欄 ${slotIndex + 1}) <span class="badge bg-danger ms-1">⚠️ 練習中</span>`;
        } else {
            titleEl.innerHTML = `<i class="fas fa-search me-2"></i>搜尋候選人 (圈選欄 ${slotIndex + 1})`;
        }
    }

    if (searchModalInstance) {
        searchModalInstance.show();
    }
}

function renderSearchResults(queryText) {
    const resultsContainer = document.getElementById('modalSearchResults');
    if (!resultsContainer) return;
    resultsContainer.innerHTML = '';

    const rawVal = queryText.trim();
    const halfWidthVal = rawVal.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248));
    const keyword = halfWidthVal.toLowerCase();

    const isPractice = (isCurrentInTutorialMode === true);
    const forcedId = isPractice ? null : itemData.forced_candidate_id;
    const isForcedCell = (!isPractice && currentTargetSlotIndex === 0 && forcedId);

    // 取得其他已選出的 ID
    const currentSlots = document.querySelectorAll('.ballot-slot-card');
    const allSelectedVals = [];
    currentSlots.forEach((slot, idx) => {
        if (idx !== currentTargetSlotIndex) {
            const val = slot.querySelector('.ballot-vote-val')?.value;
            if (val) allSelectedVals.push(val);
        }
    });

    const activeDistricts = roundData.selected_districts || itemData.selected_districts;
    const selectedDistrictsCount = {};
    if (!isPractice && itemData.require_district && activeDistricts) {
        allSelectedVals.forEach(cid => {
            if (cid !== forcedId && candidatesMap[cid] && candidatesMap[cid].district) {
                const dist = candidatesMap[cid].district;
                selectedDistrictsCount[dist] = (selectedDistrictsCount[dist] || 0) + 1;
            }
        });
    }

    // 取得候選人清單：練習模式使用全場候選人資料庫名單，正式投票使用當前輪次名單
    let candidateList = [];
    if (isPractice) {
        candidateList = Object.values(allElectionCandidatesMap);
    } else {
        candidateList = (roundData.candidate_ids || [])
            .map(cid => candidatesMap[cid] ? { id: cid, ...candidatesMap[cid] } : null)
            .filter(Boolean);
    }

    // 依候選人號碼自然排序
    candidateList.sort((a, b) => {
        return String(a.number || '').localeCompare(String(b.number || ''), 'zh-TW', { numeric: true });
    });

    let matchCount = 0;
    candidateList.forEach(c => {
        const cid = c.id;
        if (!isPractice) {
            if (isForcedCell) {
                if (cid !== forcedId) return;
            } else {
                if (cid === forcedId) return;
            }

            // 分區限制過濾：若該分區應選配額 <= 0，且非保留名額，直接不納入搜尋
            if (!isForcedCell && itemData.require_district && activeDistricts && c.district) {
                const distQuota = activeDistricts[c.district] !== undefined ? parseInt(activeDistricts[c.district]) : 0;
                if (distQuota <= 0) {
                    return; // 該分區名額為 0，不顯示
                }
            }
        }

        const rawSearchStr = `${c.number || ''} ${c.name} ${c.district || ''} ${c.unit || ''}`;
        const searchStr = rawSearchStr.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248)).toLowerCase();

        if (keyword === '' || searchStr.includes(keyword)) {
            const isAlreadySelected = allSelectedVals.includes(cid);
            let isDistrictFull = false;
            if (!isPractice && !isForcedCell && itemData.require_district && activeDistricts && c.district) {
                const limit = activeDistricts[c.district] !== undefined ? parseInt(activeDistricts[c.district]) : 0;
                const currentCount = selectedDistrictsCount[c.district] || 0;
                if (currentCount >= limit) {
                    isDistrictFull = true;
                }
            }

            const isDisabled = isAlreadySelected || isDistrictFull;
            let disabledReason = '';
            if (isAlreadySelected) disabledReason = '<span class="badge bg-secondary ms-auto">已在其他欄圈選</span>';
            else if (isDistrictFull) disabledReason = '<span class="badge bg-warning text-dark ms-auto">此區名額已滿</span>';

            const photoHtml = c.photo_base64 
                ? `<img src="${c.photo_base64}" class="rounded-circle border me-3" style="width: 42px; height: 42px; object-fit: cover;">`
                : `<div class="rounded-circle border bg-light d-flex align-items-center justify-content-center text-muted me-3" style="width: 42px; height: 42px; flex-shrink: 0;"><i class="fas fa-user"></i></div>`;

            const itemDiv = document.createElement('div');
            itemDiv.className = `offcanvas-candidate-item shadow-sm ${isDisabled ? 'disabled' : ''}`;
            itemDiv.innerHTML = `
                ${photoHtml}
                <div class="text-start flex-grow-1">
                    <div class="d-flex align-items-center">
                        <span class="badge bg-primary me-2">${c.number || '-'}</span>
                        <strong class="fs-5 text-dark">${c.name}</strong>
                    </div>
                    <div class="small text-muted mt-1">${c.district || ''} ${c.unit || ''}</div>
                </div>
                ${disabledReason ? disabledReason : '<i class="fas fa-check-circle text-primary fs-5 ms-2"></i>'}
            `;

            if (!isDisabled) {
                itemDiv.addEventListener('click', () => {
                    setSlotCandidate(currentTargetSlotIndex, cid);
                    if (searchModalInstance) searchModalInstance.hide();
                });
            }

            resultsContainer.appendChild(itemDiv);
            matchCount++;
        }
    });

    if (matchCount === 0) {
        resultsContainer.innerHTML = '<div class="p-4 text-center text-muted"><i class="fas fa-search me-1"></i>找不到符合的候選人</div>';
    }
}

// 將候選人設定進槽位
function setSlotCandidate(slotIndex, cid) {
    const isPractice = (isCurrentInTutorialMode === true);
    const c = candidatesMap[cid] || allElectionCandidatesMap[cid];
    if (!c) return;

    const slotCard = document.getElementById(`ballotSlotCard_${slotIndex}`);
    if (!slotCard) return;

    const unselectedBox = slotCard.querySelector('.slot-unselected-box');
    const selectedBox = slotCard.querySelector('.slot-selected-box');
    const hiddenVal = slotCard.querySelector('.ballot-vote-val');
    const statusBadge = slotCard.querySelector('.slot-status-badge');

    hiddenVal.value = cid;

    // 更新候選人內容
    slotCard.querySelector('.slot-candidate-name').textContent = c.name;
    slotCard.querySelector('.slot-candidate-dist').textContent = (c.district || '') + ' ' + (c.unit || '');
    
    const numBadge = slotCard.querySelector('.slot-candidate-num');
    const isForcedCell = (!isPractice && slotIndex === 0 && itemData.forced_candidate_id === cid);
    if (isForcedCell) {
        numBadge.className = 'badge bg-warning text-dark me-2 slot-candidate-num fs-6';
        numBadge.textContent = '保障';
        selectedBox.style.background = '#fff9db';
        selectedBox.style.borderColor = '#ffc107';
    } else {
        numBadge.className = 'badge bg-primary me-2 slot-candidate-num fs-6';
        numBadge.textContent = c.number || '-';
        selectedBox.style.background = '#eef6ff';
        selectedBox.style.borderColor = '#0d6efd';
    }

    const photoEl = slotCard.querySelector('.slot-candidate-photo');
    const placeholderEl = slotCard.querySelector('.slot-candidate-placeholder');
    if (c.photo_base64) {
        photoEl.src = c.photo_base64;
        photoEl.style.display = 'block';
        placeholderEl.style.display = 'none';
    } else {
        photoEl.src = '';
        photoEl.style.display = 'none';
        placeholderEl.style.display = 'flex';
    }

    unselectedBox.style.setProperty('display', 'none', 'important');
    selectedBox.style.display = 'flex';
    statusBadge.innerHTML = isPractice 
        ? '<span class="text-success"><i class="fas fa-check-circle"></i> 已選擇 (練習)</span>' 
        : '<span class="text-success"><i class="fas fa-check-circle"></i> 已圈選</span>';
}

// 清除槽位回空白
function clearSlotCandidate(slotIndex) {
    const slotCard = document.getElementById(`ballotSlotCard_${slotIndex}`);
    if (!slotCard) return;

    const unselectedBox = slotCard.querySelector('.slot-unselected-box');
    const selectedBox = slotCard.querySelector('.slot-selected-box');
    const hiddenVal = slotCard.querySelector('.ballot-vote-val');
    const statusBadge = slotCard.querySelector('.slot-status-badge');

    hiddenVal.value = '';
    selectedBox.style.display = 'none';
    unselectedBox.style.setProperty('display', 'flex', 'important');
    statusBadge.textContent = isCurrentInTutorialMode ? '尚未選擇 (練習中)' : '尚未圈選 (空白票)';
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

        // 1. 驗證輪次與選舉狀態 (防止投票已截止或發布後仍能送出選票)
        const roundRef = doc(db, 'elections', currentElectionId, 'items', itemData.id, 'rounds', roundData.id);
        const latestRoundSnap = await getDoc(roundRef);
        if (!latestRoundSnap.exists()) {
            throw new Error("此輪次不存在。");
        }
        const latestRoundData = latestRoundSnap.data();
        if (latestRoundData.status !== 'ACTIVE') {
            await Swal.fire({
                title: '投票已結束',
                text: '本輪投票已由主席宣布截止，很遺憾您的選票未能在時間內送出，此選票已被作廢。',
                icon: 'warning',
                confirmButtonText: '確定'
            });
            switchView('view-auth');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> 確認送出選票';
            return;
        }

        // 2. 驗證金鑰狀態
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
        hasSubmittedVote = true;

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
    const overlay = document.getElementById('advancedTutorialOverlay');
    const introScreen = document.getElementById('tutorialIntroScreen');
    const mockBallotCard = document.getElementById('mockBallotCard');
    const startBtnOverlay = document.getElementById('tutorialStartBtnOverlay');
    const btnNext = document.getElementById('btnTutorialNext');
    
    const inlineTooltip = document.getElementById('inlineTooltip');
    const inlineTooltipText = document.getElementById('inlineTooltipText');
    
    const searchGroup = document.getElementById('mockSearchGroup');
    const searchInput = document.getElementById('mockSearchInput');
    const dropdown = document.getElementById('mockDropdown');
    const candidateList = document.getElementById('mockCandidateList');
    const submitBtn = document.getElementById('mockSubmitBtn');
    const finalSuccess = document.getElementById('tutorialFinalSuccess');
    
    // Prevent background scrolling
    document.body.style.overflow = 'hidden';

    let currentStep = 0;
    let selectedCandidate = null;

    overlay.style.display = 'flex';
    introScreen.style.display = 'block';
    mockBallotCard.style.display = 'none';
    
    // 綁定所有「跳過教學直接投票」按鈕
    document.querySelectorAll('.btn-skip-tutorial-action').forEach(skipBtn => {
        skipBtn.onclick = () => {
            overlay.style.display = 'none';
            document.body.style.overflow = '';
            localStorage.setItem(`tutorial_completed_${currentElectionId}`, 'true');
            if (typeof currentKeyCode !== 'undefined' && currentKeyCode) {
                localStorage.setItem(`tutorial_completed_${currentKeyCode}`, 'true');
            }
            switchView('view-ballot');
        };
    });

    document.getElementById('btnStartTutorial').onclick = () => {
        currentStep = 1;
        introScreen.style.display = 'none';
        mockBallotCard.style.display = 'block';
        updateStepUI();
    };

    // Virtual candidates for Step 3 and 7
    const candidatesAll = [
        { num: '001', name: '亞伯拉罕' },
        { num: '002', name: '以撒' },
        { num: '003', name: '雅各' },
        { num: '004', name: '摩西' },
        { num: '005', name: '撒母耳' },
        { num: '006', name: '大衛' },
        { num: '007', name: '以利亞' },
        { num: '008', name: '馬太' },
        { num: '009', name: '馬可' },
        { num: '010', name: '路加' }
    ];
    
    const renderList = (cands, requiredTarget = null) => {
        // Clear old list and arrow
        const oldArrow = document.getElementById('scrollArrowOverlay');
        if (oldArrow) oldArrow.remove();
        
        candidateList.innerHTML = '';
        cands.forEach(c => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'list-group-item p-3 border-bottom d-flex align-items-center bg-white text-start w-100';
            btn.style.cursor = 'pointer';
            btn.style.border = 'none';
            btn.innerHTML = `
                <div class="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center me-3" style="width: 40px; height: 40px;">
                    <i class="fas fa-user"></i>
                </div>
                <div>
                    <span class="badge bg-dark me-2 fs-6">${c.num}</span>
                    <strong class="fs-5">${c.name}</strong>
                </div>
            `;
            
            // Hover effect mimicking real UI is handled by CSS :hover, avoid JS mouse events on iOS
            
            const handleInteract = (e) => {
                e.stopPropagation();
                
                // 步驟 3 是純滑動，步驟 6 是純打字，禁止點選清單
                if (currentStep === 6 || currentStep === 3) {
                    return;
                }
                
                if (requiredTarget && c.num !== requiredTarget) {
                    // Do nothing, just ignore the click.
                } else {
                    handleCorrectSelection(c);
                }
            };

            // Robust touch handler for iOS (fixes finger-roll click failures and hover double-tap issues)
            let startY = 0;
            let startX = 0;
            btn.addEventListener('touchstart', (e) => {
                startY = e.touches[0].clientY;
                startX = e.touches[0].clientX;
            }, {passive: true});

            btn.addEventListener('touchend', (e) => {
                const endY = e.changedTouches[0].clientY;
                const endX = e.changedTouches[0].clientX;
                // If finger didn't move much, it's a tap!
                if (Math.abs(endY - startY) < 15 && Math.abs(endX - startX) < 15) {
                    if (e.cancelable) {
                        e.preventDefault(); // Prevent ghost click, double-tap zoom, and hover simulation
                    }
                    handleInteract(e);
                }
            });

            // Fallback for desktop/mouse users
            btn.addEventListener('click', handleInteract);
            
            candidateList.appendChild(btn);
        });
    };

    
    // iOS Safari 終極鎖定：在步驟 3.5 時，強制攔截所有滑動事件，防止任何殘留動量或越獄滑動
    document.addEventListener('touchmove', (e) => {
        if (currentStep === 3.5) {
            e.preventDefault();
        }
    }, { passive: false });

const updateStepUI = () => {
        // Reset states
        startBtnOverlay.style.display = 'none';
        searchGroup.style.border = '2px solid transparent';
        searchGroup.style.animation = 'none';
        inlineTooltip.style.display = 'none';
        searchInput.readOnly = true;
        dropdown.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.6';
        submitBtn.style.animation = 'none';
        
        const oldArrow = document.getElementById('scrollArrowOverlay');
        if (oldArrow) oldArrow.remove();
        
        switch (currentStep) {
            case 1:
                inlineTooltip.style.display = 'none';
                startBtnOverlay.style.display = 'flex';
                document.getElementById('tutorialOverlayTitle').innerHTML = '<i class="fas fa-hand-pointer text-primary mb-3" style="font-size:3rem;"></i><br>第一部分：滑動選人';
                document.getElementById('tutorialOverlayDesc').innerHTML = '學習如何滑動名單並點選';
                btnNext.innerHTML = '<i class="fas fa-play-circle"></i> 開始學習';
                btnNext.className = 'btn btn-primary fw-bold shadow-sm w-75';
                btnNext.onclick = () => { currentStep = 2; updateStepUI(); };
                break;
                
            case 2:
                inlineTooltipText.innerHTML = "👉 步驟 1：請點擊下方的『圈選欄』";
                inlineTooltip.style.display = 'block';
                searchGroup.style.border = '3px solid #dc3545'; // Red target
                searchGroup.style.animation = 'pulseRed 1.5s infinite';
                searchInput.onclick = (e) => {
                    if (currentStep === 2) {
                        currentStep = 3; 
                        updateStepUI();
                    }
                };
                break;
                
            case 3:
                overlay.style.overflowY = 'auto'; // 確保可滑動
                inlineTooltipText.innerHTML = "👉 步驟 2：請往上滑動畫面，找到「<strong class='text-warning'>008 馬太</strong>」";
                inlineTooltip.style.display = 'block';
                dropdown.style.display = 'block';
                dropdown.style.border = '1px solid #ced4da';
                dropdown.style.animation = 'none';
                renderList(candidatesAll, '008'); // 第一階段：純滑動，不接受點擊
                
                // Add Scroll Arrow
                const arrow = document.createElement('div');
                arrow.id = 'scrollArrowOverlay';
                arrow.className = 'scroll-arrow-overlay';
                arrow.innerHTML = '⬆ 請往上滑動';
                overlay.appendChild(arrow);

                // Auto advance when 008 is visible
                const btn008 = Array.from(candidateList.children).find(b => b.innerHTML.includes('008'));
                if (btn008) {
                    const observer = new IntersectionObserver((entries) => {
                        if (entries[0].isIntersecting && currentStep === 3) {
                            observer.disconnect();
                            currentStep = 3.5;
                            updateStepUI();
                        }
                    }, { root: overlay, threshold: 0.9 });
                    observer.observe(btn008);
                }
                break;
                
            case 3.5:
                overlay.style.overflowY = 'hidden'; // 鎖定滑動！強制學習點擊
                dropdown.style.display = 'block'; // 確保選單依然可見
                inlineTooltip.style.display = 'block'; // 確保提示視窗可見
                
                // 強制重新渲染列表，強迫 WebKit 重新計算鎖定後的點擊感應區塊座標
                renderList(candidatesAll, '008');
                
                // Highlight 008 button
                const targetBtn = Array.from(candidateList.children).find(b => b.innerHTML.includes('008'));
                if (targetBtn) {
                    targetBtn.style.border = '3px solid #dc3545';
                    targetBtn.style.animation = 'pulseRed 1.5s infinite';
                    targetBtn.style.borderRadius = '8px';
                }
                
                inlineTooltipText.innerHTML = "👉 步驟 3：選擇你要圈選的候選人「<strong class='text-warning'>008 馬太</strong>」";
                break;
                
            case 3.8:
                inlineTooltip.style.display = 'none';
                dropdown.style.display = 'none';
                startBtnOverlay.style.display = 'flex';
                document.getElementById('tutorialOverlayTitle').innerHTML = '<i class="fas fa-check-circle text-success mb-3" style="font-size:3rem;"></i><br>選擇成功！';
                document.getElementById('tutorialOverlayDesc').innerHTML = '您已完成第一項學習：滑動與點選';
                btnNext.innerHTML = '<i class="fas fa-arrow-right"></i> 繼續下一項學習';
                btnNext.className = 'btn btn-success fw-bold shadow-sm w-75';
                btnNext.onclick = () => { 
                    overlay.style.overflowY = 'auto'; // 恢復滑動
                    currentStep = 4; 
                    updateStepUI(); 
                };
                break;
                
            case 4:
                // Reset Selection
                searchInput.value = "";
                selectedCandidate = null;
                dropdown.style.border = '1px solid #ced4da';
                dropdown.style.animation = 'none';
                
                inlineTooltip.style.display = 'none';
                startBtnOverlay.style.display = 'flex';
                document.getElementById('tutorialOverlayTitle').innerHTML = '<i class="fas fa-search text-info mb-3" style="font-size:3rem;"></i><br>第二部分：搜尋功能';
                document.getElementById('tutorialOverlayDesc').innerHTML = '名單太長？學習如何快速搜尋';
                btnNext.innerHTML = '<i class="fas fa-play-circle"></i> 開始學習';
                btnNext.className = 'btn btn-info text-white fw-bold shadow-sm w-75';
                btnNext.onclick = () => { currentStep = 5; updateStepUI(); };
                break;
                
            case 5:
                inlineTooltipText.innerHTML = "👉 步驟 1：請再次點擊下方的『圈選欄』";
                inlineTooltip.style.display = 'block';
                searchGroup.style.border = '3px solid #dc3545'; 
                searchGroup.style.animation = 'pulseRed 1.5s infinite';
                searchInput.onclick = (e) => {
                    if (currentStep === 5) {
                        currentStep = 6; 
                        updateStepUI();
                    }
                };
                break;
                
            case 6:
                inlineTooltipText.innerHTML = "👉 步驟 2：請輸入數字「<strong class='text-warning'>1</strong>」";
                inlineTooltip.style.display = 'block';
                searchGroup.style.border = '3px solid #dc3545';
                dropdown.style.display = 'block';
                
                // Show 11 candidates for long dropdown effect
                const candidatesStep6 = [
                    { num: '001', name: '亞伯拉罕' },
                    { num: '002', name: '以撒' },
                    { num: '003', name: '雅各' },
                    { num: '004', name: '摩西' },
                    { num: '005', name: '撒母耳' },
                    { num: '006', name: '大衛' },
                    { num: '007', name: '以利亞' },
                    { num: '008', name: '馬太' },
                    { num: '009', name: '馬可' },
                    { num: '010', name: '路加' },
                    { num: '011', name: '保羅' }
                ];
                renderList(candidatesStep6, null); // Show all before typing
                
                searchInput.readOnly = false;
                searchInput.focus();
                
                // Clear old listener
                const newSearchInput = searchInput.cloneNode(true);
                searchInput.parentNode.replaceChild(newSearchInput, searchInput);
                
                newSearchInput.addEventListener('input', (e) => {
                    const val = e.target.value.trim();
                    if (val === '1') {
                        currentStep = 7;
                        updateStepUI();
                    } else if (val.length > 0) {
                        // Just clear it silently without interrupting the user
                        newSearchInput.value = '';
                    }
                });
                break;
                
            case 7:
                // Restore search input reference
                const currSearchInput = document.getElementById('mockSearchInput');
                currSearchInput.readOnly = false; // keep it focused/editable
                
                inlineTooltipText.innerHTML = "👉 步驟 6：請從搜尋結果中點選「<strong class='text-warning'>010 路加</strong>」";
                inlineTooltip.style.display = 'block';
                dropdown.style.display = 'block';
                dropdown.style.border = '1px solid #ced4da';
                dropdown.style.animation = 'none';
                
                // Show filtered list
                renderList([
                    { num: '001', name: '亞伯拉罕' },
                    { num: '010', name: '路加' },
                    { num: '011', name: '保羅' }
                ], '010');
                
                // Highlight ONLY 010 button
                const targetBtn010 = Array.from(candidateList.children).find(b => b.innerHTML.includes('010'));
                if (targetBtn010) {
                    targetBtn010.style.border = '3px solid #dc3545';
                    targetBtn010.style.animation = 'pulseRed 1.5s infinite';
                    targetBtn010.style.borderRadius = '8px';
                }
                break;
                
            case 8:
                const finalSearchInput = document.getElementById('mockSearchInput');
                finalSearchInput.readOnly = true;
                finalSearchInput.value = `010 路加`;
                dropdown.style.border = '1px solid #ced4da';
                
                inlineTooltipText.innerHTML = "👉 最後一步：確認無誤，請點擊下方的『確認送出選票』";
                inlineTooltip.style.display = 'block';
                
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.border = '3px solid #dc3545';
                submitBtn.style.animation = 'pulseRed 1s infinite';
                
                submitBtn.onclick = () => {
                    // Success End
                    inlineTooltip.style.display = 'none';
                    dropdown.style.display = 'none';
                    startBtnOverlay.style.display = 'flex';
                    document.getElementById('tutorialOverlayTitle').innerHTML = '<i class="fas fa-check-circle text-success mb-3" style="font-size:3rem;"></i><br>教學完成！';
                    document.getElementById('tutorialOverlayDesc').innerHTML = '您現在可以正式開始投票了';
                    btnNext.innerHTML = '<i class="fas fa-vote-yea"></i> 進入投票';
                    btnNext.className = 'btn btn-success fw-bold shadow-sm w-75';
                    btnNext.onclick = () => {
                        overlay.style.display = 'none';
                        document.body.style.overflow = ''; // Restore scrolling
                        localStorage.setItem(`tutorial_completed_${currentElectionId}`, 'true');
                        if (typeof currentKeyCode !== 'undefined' && currentKeyCode) {
                            localStorage.setItem(`tutorial_completed_${currentKeyCode}`, 'true');
                        }
                        switchView('view-ballot');
                    };
                };
                break;
        }
    };

    const handleCorrectSelection = (c) => {
        const currInput = document.getElementById('mockSearchInput');
        currInput.value = `${c.num} ${c.name}`;
        if (currentStep === 3.5) {
            currentStep = 3.8;
            updateStepUI();
        } else if (currentStep === 7) {
            // Instant advance
            currentStep = 8;
            updateStepUI();
        }
    };

    updateStepUI();
}






