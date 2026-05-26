const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// 1. 初始化 Firebase Admin SDK
try {
    // 優先檢查是否有設定環境變數 (用於 Cloud Run 跨專案)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccountConfig = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccountConfig)
        });
        console.log('✅ Firebase Admin SDK 初始化成功 (透過 Cloud Run 環境變數)！');
    } else {
        // 本機開發：尋找 firebase-adminsdk.json
        const serviceAccount = require('./firebase-adminsdk.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('✅ Firebase Admin SDK 初始化成功 (本機 JSON 金鑰)！');
    }
} catch (error) {
    // 雲端環境：Fallback Cloud Run 會自動帶入預設的 GCP 服務帳戶憑證
    console.log('⚠️ 找不到明確的金鑰，改為嘗試使用 Cloud Run 預設憑證初始化...');
    admin.initializeApp();
    console.log('✅ Firebase Admin SDK 初始化成功 (Cloud Run 預設憑證)！');
}

const db = admin.firestore();

// 2. 初始化 Express 應用程式
const app = express();

// 設定 CORS 與 JSON 解析
app.use(cors());
app.use(express.json());

// 註冊 API 路由
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// 3. 基礎路由測試
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '⛪ 教會數位選舉系統 API 伺服器運作中',
        version: '1.0.0'
    });
});

// 健康檢查路由 (用來確認資料庫連線)
app.get('/api/health', async (req, res) => {
    try {
        // 嘗試讀取一個測試集合來驗證連線
        const snapshot = await db.collection('system_status').limit(1).get();
        res.json({
            success: true,
            message: 'Firestore 資料庫連線正常！',
            db_connected: true
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Firestore 連線失敗',
            error: error.message
        });
    }
});

// 4. 啟動伺服器
const PORT = process.env.PORT || 8080; // Cloud Run 預設為 8080
app.listen(PORT, () => {
    console.log(`🚀 伺服器已啟動，正在監聽 Port ${PORT}`);
    console.log(`👉 請在瀏覽器開啟 http://localhost:${PORT} 進行測試`);
});
