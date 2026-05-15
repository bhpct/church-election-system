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
        // 這邊我們將使用者的基本資料寫入 db，方便管理員在後台看到是誰
        const db = admin.firestore();
        await db.collection('users').doc(lineUid).set({
            name: name,
            picture: picture || null,
            lastLogin: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // 3. 利用 Firebase Admin SDK 產生自訂權杖 (Custom Token)
        const customToken = await admin.auth().createCustomToken(lineUid);

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

module.exports = router;
