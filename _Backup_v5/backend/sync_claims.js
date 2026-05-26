const admin = require('firebase-admin');
const serviceAccount = require('./firebase-adminsdk.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function syncClaims() {
    console.log("開始同步 Firestore 與 Firebase Auth 的權限...");
    try {
        const usersSnap = await db.collection('users').get();
        for (const userDoc of usersSnap.docs) {
            const userData = userDoc.data();
            const uid = userDoc.id;
            
            const newRole = userData.role || 'GUEST';
            const org_ids = userData.org_ids || [];
            
            try {
                // 確認使用者存在於 Auth
                await admin.auth().getUser(uid);
                
                await admin.auth().setCustomUserClaims(uid, {
                    role: newRole,
                    org_ids: org_ids
                });
                console.log(`✅ 已同步使用者: ${userData.name || uid} (Role: ${newRole}, Orgs: ${org_ids.length})`);
            } catch (e) {
                if (e.code === 'auth/user-not-found') {
                    console.log(`⚠️ 找不到 Auth 用戶: ${uid} (可能已被刪除)`);
                } else {
                    console.error(`❌ 同步 ${uid} 失敗:`, e);
                }
            }
        }
        console.log("🎉 所有權限同步完成！");
    } catch (err) {
        console.error("腳本執行失敗:", err);
    }
    process.exit(0);
}

syncClaims();
