const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

/**
 * 驗證請求者是否為 SUPER_ADMIN 的 Middleware
 */
async function verifySuperAdmin(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: '缺少驗證憑證' });
        }
        
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        
        if (decodedToken.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ success: false, message: '權限不足，需要超級管理員權限' });
        }
        
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('驗證管理員失敗:', error);
        res.status(401).json({ success: false, message: '無效的憑證' });
    }
}

/**
 * 徹底刪除機構 (包含連鎖刪除選舉場次與解除管理員職務)
 * DELETE /api/admin/organizations/:orgId
 */
router.delete('/organizations/:orgId', verifySuperAdmin, async (req, res) => {
    try {
        const orgId = req.params.orgId;
        const db = admin.firestore();
        
        // 1. 取得機構資訊 (為了知道誰是管理員)
        const orgRef = db.collection('organizations').doc(orgId);
        const orgDoc = await orgRef.get();
        
        if (!orgDoc.exists) {
            return res.status(404).json({ success: false, message: '找不到該機構' });
        }
        
        const batch = db.batch();

        // 2. 解除管理員職務 (已棄用)
        // 因為改為多對多關係 (org_ids)，管理員被剝奪權限的動作將在前端「編輯管理員授權」時進行
        // 刪除機構單純只連鎖刪除選舉場次

        // 3. 找出所有隸屬於該機構的選舉場次
        const electionsSnapshot = await db.collection('elections')
                                          .where('org_id', '==', orgId)
                                          .get();
        
        // 準備連鎖刪除選舉場次
        electionsSnapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
            // 備註：如果選舉底下還有選票(votes)的 subcollection，
            // 由於 Firestore 的限制，需要另外寫遞迴邏輯或 Cloud Function 處理。
            // 這裡我們先刪除第一層的選舉文件。
        });

        // 4. 刪除機構本身
        batch.delete(orgRef);

        // 5. 執行批次寫入
        await batch.commit();

        res.json({ success: true, message: '機構及相關資料已徹底刪除' });

    } catch (error) {
        console.error('刪除機構失敗:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤', error: error.message });
    }
});

/**
 * 驗證請求者是否有登入憑證的 Middleware
 */
async function verifyAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: '缺少驗證憑證' });
        }
        
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('驗證登入失敗:', error);
        res.status(401).json({ success: false, message: '憑證無效' });
    }
}

// 3. 更新使用者權限 (Custom Claims 與 Firestore)
router.post('/update_user_claims', verifyAuth, async (req, res) => {
    try {
        const { targetUid, newRole, org_roles } = req.body;
        
        if (!targetUid || !newRole) {
            return res.status(400).json({ success: false, message: '缺少必要參數' });
        }

        const db = admin.firestore();

        // 確認發出請求的用戶身分與權限
        const callerUid = req.user.uid;
        const callerDoc = await db.collection('users').doc(callerUid).get();
        if (!callerDoc.exists) {
            return res.status(403).json({ success: false, message: '找不到發出請求的使用者' });
        }
        
        const callerData = callerDoc.data();
        const isGlobalSuperAdmin = callerData.role === 'SUPER_ADMIN';
        const callerOrgRoles = callerData.org_roles || {};

        if (!isGlobalSuperAdmin) {
            // 單位超級管理員不能授予或修改全域 SUPER_ADMIN
            if (newRole === 'SUPER_ADMIN') {
                return res.status(403).json({ success: false, message: '權限不足，不能授予全域超級管理員' });
            }
            
            // 驗證是否具備至少一個單位的 ORG_SUPER_ADMIN
            const isOrgSuperAdmin = Object.values(callerOrgRoles).includes('ORG_SUPER_ADMIN');
            if (!isOrgSuperAdmin) {
                return res.status(403).json({ success: false, message: '權限不足，必須為超級管理員或單位超級管理員' });
            }
        }

        // 讀取目標使用者的當前權限，進行安全合併
        const targetDoc = await db.collection('users').doc(targetUid).get();
        let targetData = targetDoc.exists ? targetDoc.data() : { role: 'GUEST', org_roles: {} };
        let finalOrgRoles = { ...(targetData.org_roles || {}) };

        // 針對請求中傳來的 org_roles，逐一檢查發出請求者是否有權限修改
        const requestedOrgRoles = org_roles || {};
        for (const [orgId, role] of Object.entries(requestedOrgRoles)) {
            // 如果是全域超管，或者在該機構是單位超管，才有權修改
            if (isGlobalSuperAdmin || callerOrgRoles[orgId] === 'ORG_SUPER_ADMIN') {
                if (!role || role === '') {
                    delete finalOrgRoles[orgId];
                } else {
                    finalOrgRoles[orgId] = role;
                }
            }
        }
        
        // 確保如果沒有任何 org_roles 時，角色不能是 ORG_ADMIN 或 ORG_SUPER_ADMIN
        let finalRole = newRole;
        if (!isGlobalSuperAdmin) {
            finalRole = Object.keys(finalOrgRoles).length > 0 ? (newRole === 'GUEST' ? 'USER' : newRole) : 'GUEST';
        }

        await admin.auth().setCustomUserClaims(targetUid, {
            role: finalRole,
            org_roles: finalOrgRoles
        });

        // 2. 同步更新 Firestore users 集合
        await db.collection('users').doc(targetUid).set({
            role: finalRole,
            org_roles: finalOrgRoles
        }, { merge: true });

        res.json({ success: true, message: '權限更新成功，使用者重新載入後生效' });

    } catch (error) {
        console.error('更新使用者權限失敗:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤', error: error.message });
    }
});

// 4. 刪除管理員 (全域管理員徹底刪除，單位超級管理員僅移除其轄下權限)
router.delete('/users/:uid', verifyAuth, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        
        if (!targetUid) {
            return res.status(400).json({ success: false, message: '缺少必要參數' });
        }

        // 確保不會刪除自己
        if (targetUid === req.user.uid) {
            return res.status(403).json({ success: false, message: '不能刪除自己的帳號' });
        }

        const db = admin.firestore();
        
        // 取得請求者身分
        const callerUid = req.user.uid;
        const callerDoc = await db.collection('users').doc(callerUid).get();
        if (!callerDoc.exists) {
            return res.status(403).json({ success: false, message: '找不到發出請求的使用者' });
        }
        
        const callerData = callerDoc.data();
        const isGlobalSuperAdmin = callerData.role === 'SUPER_ADMIN';
        const callerOrgRoles = callerData.org_roles || {};

        if (isGlobalSuperAdmin) {
            // 1. 全域管理員：從 Firebase Auth 徹底刪除用戶
            await admin.auth().deleteUser(targetUid);
            // 2. 從 Firestore 刪除用戶記錄
            await db.collection('users').doc(targetUid).delete();
            return res.json({ success: true, message: '使用者已成功刪除' });
        } else {
            // 單位超級管理員：進行局部權限移除 (只移除自己管轄的機構權限)
            const isOrgSuperAdmin = Object.values(callerOrgRoles).includes('ORG_SUPER_ADMIN');
            if (!isOrgSuperAdmin) {
                return res.status(403).json({ success: false, message: '權限不足，必須為超級管理員或單位超級管理員' });
            }

            const targetDoc = await db.collection('users').doc(targetUid).get();
            if (!targetDoc.exists) {
                return res.status(404).json({ success: false, message: '找不到目標使用者' });
            }

            let targetData = targetDoc.data();
            let finalOrgRoles = { ...(targetData.org_roles || {}) };
            let permissionsRemoved = 0;

            // 移除請求者具備 ORG_SUPER_ADMIN 權限之機構的對應角色
            for (const [orgId, localRole] of Object.entries(callerOrgRoles)) {
                if (localRole === 'ORG_SUPER_ADMIN' && finalOrgRoles[orgId]) {
                    delete finalOrgRoles[orgId];
                    permissionsRemoved++;
                }
            }

            if (permissionsRemoved === 0) {
                return res.status(403).json({ success: false, message: '無法刪除，您對該使用者的機構沒有管轄權' });
            }

            // 更新角色狀態：若已無任何機構權限，則降級為 GUEST
            let finalRole = targetData.role;
            if (Object.keys(finalOrgRoles).length === 0) {
                finalRole = 'GUEST';
            }

            // 寫入 Auth Custom Claims
            await admin.auth().setCustomUserClaims(targetUid, {
                role: finalRole,
                org_roles: finalOrgRoles
            });

            // 寫入 Firestore
            await db.collection('users').doc(targetUid).update({
                role: finalRole,
                org_roles: finalOrgRoles
            });

            return res.json({ success: true, message: '已成功移除該使用者在您管轄單位的權限' });
        }

    } catch (error) {
        console.error('刪除使用者失敗:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤', error: error.message });
    }
});

// 5. 產生限時 6 碼授權序號
router.post('/generate_auth_code', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: '缺少驗證憑證' });
        }
        
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const { orgId } = req.body;

        if (!orgId) {
            return res.status(400).json({ success: false, message: '必須指定機構 ID' });
        }

        // 權限檢查：必須是全域 SUPER_ADMIN，或者是該單位的 ORG_SUPER_ADMIN
        const isSuperAdmin = decodedToken.role === 'SUPER_ADMIN';
        const isOrgSuperAdmin = decodedToken.org_roles && decodedToken.org_roles[orgId] === 'ORG_SUPER_ADMIN';

        if (!isSuperAdmin && !isOrgSuperAdmin) {
            return res.status(403).json({ success: false, message: '權限不足，僅限該單位的超級管理員操作' });
        }

        const db = admin.firestore();
        
        // 產生 6 碼隨機數字
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // 寫入 Firestore，設定 5 分鐘後過期
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 5);

        await db.collection('auth_codes').doc(code).set({
            code: code,
            orgId: orgId,
            generatedBy: decodedToken.uid,
            roleGranted: 'ORG_ADMIN', // 預設給予一般管理員權限
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ 
            success: true, 
            code: code,
            expiresAt: expiresAt.getTime(),
            message: '授權碼產生成功' 
        });

    } catch (error) {
        console.error('產生授權碼失敗:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤', error: error.message });
    }
});

module.exports = router;
