const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const router = express.Router();

/**
 * 驗證 LINE id_token 並發放 Firebase Custom Token
 * POST /api/auth/verify
 * Body: { idToken: "LINE_ID_TOKEN_STRING" }
 */
router.post('/verify', async (req, res) => {
    try {
        const { idToken } = req.body;
        
        if (!idToken) {
            return res.status(400).json({
                success: false,
                message: '缺少 idToken'
            });
        }

        const channelId = process.env.LINE_CHANNEL_ID;
        if (!channelId) {
            console.error('❌ 後端尚未設定 LINE_CHANNEL_ID');
            return res.status(500).json({ success: false, message: '伺服器設定錯誤' });
        }

        // 1. 向 LINE 伺服器驗證 Token 是否合法
        const params = new URLSearchParams();
        params.append('id_token', idToken);
        params.append('client_id', channelId);

        let lineResponse;
        try {
            lineResponse = await axios.post('https://api.line.me/oauth2/v2.1/verify', params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
        } catch (error) {
            console.error('❌ LINE 驗證失敗:', error.response?.data || error.message);
            return res.status(401).json({
                success: false,
                message: '無效的 LINE 憑證',
                error: error.response?.data?.error_description || '驗證失敗'
            });
        }

        const lineData = lineResponse.data;
        // lineData.sub 就是用戶的 LINE UID
        const lineUid = lineData.sub;
        const name = lineData.name;
        const picture = lineData.picture;

        console.log(`✅ 成功驗證 LINE 用戶: ${name} (${lineUid})`);

        // 2. 更新或建立使用者在 Firestore 的基礎資料 (選用，為了日後容易辨識)
        const db = admin.firestore();
        const userRef = db.collection('users').doc(lineUid);
        const userDoc = await userRef.get();

        let role = 'GUEST'; // 全域角色 (預設為無)
        let org_roles = {}; // 機構權限 Map (orgId -> Role)
        
        if (!userDoc.exists) {
            // 如果是新用戶，檢查是否為系統的第一位使用者
            const usersSnapshot = await db.collection('users').limit(1).get();
            if (usersSnapshot.empty) {
                role = 'SUPER_ADMIN'; // 首位登入者自動獲得最高權限
                console.log(`👑 系統首位用戶登入，自動賦予 SUPER_ADMIN 權限: ${name}`);
            }

            // 建立新用戶資料
            await userRef.set({
                name: name,
                picture: picture || null,
                role: role,
                org_roles: org_roles,
                auth_attempts: 0,
                auth_locked_until: null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                lastLogin: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            // 已存在之用戶，讀取既有權限與機構陣列
            const data = userDoc.data();
            role = data.role || 'GUEST';
            org_roles = data.org_roles || {};
            
            // 更新登入時間與頭像
            await userRef.set({
                name: name,
                picture: picture || null,
                lastLogin: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        // 3. 利用 Firebase Admin SDK 產生自訂權杖 (Custom Token)，並將 role 與 org_ids 夾帶進去
        const customToken = await admin.auth().createCustomToken(lineUid, { 
            role: role,
            org_roles: org_roles
        });

        // 4. 回傳給前端
        res.json({
            success: true,
            message: '登入驗證成功',
            data: {
                firebaseToken: customToken,
                user: {
                    uid: lineUid,
                    name: name,
                    picture: picture
                }
            }
        });

    } catch (error) {
        console.error('❌ 伺服器內部錯誤:', error);
        res.status(500).json({
            success: false,
            message: '伺服器內部錯誤',
            error: error.message,
            fullError: String(error),
            stack: error.stack
        });
    }
});

/**
 * 驗證 6 碼授權序號並加入單位
 * POST /api/auth/verify_auth_code
 * Body: { code: '123456' }
 */
router.post('/verify_auth_code', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: '缺少驗證憑證' });
        }
        
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        const { code } = req.body;

        if (!code || code.length !== 6) {
            return res.status(400).json({ success: false, message: '請輸入正確的 6 碼序號' });
        }

        const db = admin.firestore();
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ success: false, message: '找不到使用者資料' });
        }

        const userData = userDoc.data();
        
        // 檢查是否被鎖定
        if (userData.auth_locked_until && userData.auth_locked_until.toDate() > new Date()) {
            const waitMinutes = Math.ceil((userData.auth_locked_until.toDate() - new Date()) / 60000);
            return res.status(429).json({ 
                success: false, 
                message: `錯誤次數過多，為了安全起見，請等待 ${waitMinutes} 分鐘後再試。` 
            });
        }

        // 查詢授權碼
        const codeRef = db.collection('auth_codes').doc(code);
        const codeDoc = await codeRef.get();

        const now = new Date();
        let isValid = false;
        let authCodeData = null;

        if (codeDoc.exists) {
            authCodeData = codeDoc.data();
            if (authCodeData.expiresAt.toDate() > now) {
                isValid = true;
            }
        }

        // 如果無效或過期
        if (!isValid) {
            let attempts = (userData.auth_attempts || 0) + 1;
            let updateData = { auth_attempts: attempts };

            if (attempts >= 3) {
                const lockUntil = new Date();
                lockUntil.setMinutes(lockUntil.getMinutes() + 10);
                updateData.auth_locked_until = admin.firestore.Timestamp.fromDate(lockUntil);
                updateData.auth_attempts = 0; // 重置次數，等解鎖後再算
            }

            await userRef.update(updateData);

            if (attempts >= 3) {
                return res.status(429).json({ success: false, message: '連續輸入錯誤達 3 次，帳號暫時鎖定 10 分鐘。' });
            } else {
                return res.status(400).json({ success: false, message: `無效或已過期的驗證碼 (剩餘嘗試次數: ${3 - attempts})` });
            }
        }

        // 驗證碼有效，進行授權綁定
        const orgId = authCodeData.orgId;
        const roleGranted = authCodeData.roleGranted || 'ORG_ADMIN';

        let org_roles = userData.org_roles || {};
        org_roles[orgId] = roleGranted; // 賦予權限

        // 更新 Auth Custom Claims
        let newRole = userData.role || 'GUEST';
        if (newRole === 'GUEST' && Object.keys(org_roles).length > 0) {
            newRole = 'ORG_ADMIN';
        }
        
        // 更新 Firestore
        await userRef.update({
            org_roles: org_roles,
            role: newRole,
            auth_attempts: 0,
            auth_locked_until: null
        });

        await admin.auth().setCustomUserClaims(uid, {
            role: newRole,
            org_roles: org_roles
        });
        
        // 備註：我們「不」刪除 codeRef，讓同一個時間點其他人也可以使用

        res.json({ 
            success: true, 
            message: '授權驗證成功，您已加入該單位管理員',
            orgId: orgId
        });

    } catch (error) {
        console.error('驗證授權碼失敗:', error);
        res.status(500).json({ success: false, message: '伺服器錯誤', error: error.message });
    }
});

module.exports = router;
