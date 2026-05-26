// 共用工具函式庫

/**
 * 寫入操作紀錄 (Audit Log)
 * @param {string} orgId - 機構 ID
 * @param {string} action - 操作類型 (例：CREATE_ELECTION, UPDATE_CANDIDATE)
 * @param {string} target - 操作對象 (例：選舉, 候選人, 公印)
 * @param {string} details - 詳細操作說明文字
 */
window.logAuditAction = async function(orgId, action, target, details) {
    try {
        if (!orgId) return; // 沒有機構 ID 則不記錄
        
        const db = window.firebaseDb;
        const user = window.firebaseAuth ? window.firebaseAuth.currentUser : null;
        
        if (!db || !user) return; // 確保 Firebase 已初始化且有使用者登入
        
        // 嘗試取得顯示名稱 (優先從畫面的 navUserName 取得，否則用 Firebase 內建的)
        let displayName = user.displayName;
        const navNameEl = document.getElementById('navUserName');
        if (navNameEl && navNameEl.textContent && navNameEl.textContent !== '載入中...' && navNameEl.textContent !== '未知使用者') {
            displayName = navNameEl.textContent;
        }

        // 如果依然沒有 displayName (例如在沒有 navUserName 的管理頁面)，嘗試從資料庫取得
        if (!displayName) {
            try {
                const { doc, getDoc } = window.fs;
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (userDoc.exists() && userDoc.data().name) {
                    displayName = userDoc.data().name;
                }
            } catch (e) {
                console.warn('Failed to fetch user name for audit log', e);
            }
        }

        if (!displayName) displayName = '未知使用者';

        const { collection, addDoc, serverTimestamp } = window.fs;
        
        await addDoc(collection(db, 'audit_logs'), {
            org_id: orgId,
            user_uid: user.uid,
            user_name: displayName,
            action: action,
            target: target,
            details: details,
            timestamp: serverTimestamp()
        });
        
    } catch (error) {
        console.error('Audit log failed:', error);
        // 背景記錄失敗時不影響主要流程，所以不需 alert
    }
};
