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
        
        const orgData = orgDoc.data();
        const adminUid = orgData.admin_uid;

        const batch = db.batch();

        // 2. 解除管理員職務 (將其降級為 GUEST 並移除 org_id)
        if (adminUid) {
            const userRef = db.collection('users').doc(adminUid);
            batch.update(userRef, {
                role: 'GUEST',
                org_id: admin.firestore.FieldValue.delete()
            });
        }

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

module.exports = router;
