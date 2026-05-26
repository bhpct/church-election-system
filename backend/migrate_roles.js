const admin = require('firebase-admin');
const serviceAccount = require('./firebase-adminsdk.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateRoles() {
    console.log("開始遷移使用者權限資料結構 (org_ids -> org_roles)...");
    try {
        const usersSnap = await db.collection('users').get();
        let migratedCount = 0;

        for (const userDoc of usersSnap.docs) {
            const userData = userDoc.data();
            const uid = userDoc.id;
            
            const newRole = userData.role || 'GUEST';
            const org_ids = userData.org_ids || [];
            
            // 轉換邏輯：將陣列轉為 Map
            const org_roles = {};
            
            // 舊架構中，如果是 SUPER_ADMIN，通常他什麼都可以管，不一定有 org_ids，
            // 若有 org_ids，舊架構皆視為 ORG_ADMIN 等級。
            org_ids.forEach(orgId => {
                org_roles[orgId] = 'ORG_ADMIN'; // 預設平移為一般管理員
            });

            try {
                // 更新 Firestore
                await db.collection('users').doc(uid).update({
                    org_roles: org_roles,
                    // 不刪除 org_ids 以策安全，但未來不再使用
                });

                // 更新 Auth Custom Claims
                try {
                    await admin.auth().getUser(uid);
                    await admin.auth().setCustomUserClaims(uid, {
                        role: newRole,
                        org_roles: org_roles
                    });
                    migratedCount++;
                    console.log(`✅ 已遷移使用者: ${userData.name || uid} (Role: ${newRole}, org_roles 數量: ${Object.keys(org_roles).length})`);
                } catch (e) {
                    if (e.code === 'auth/user-not-found') {
                        console.log(`⚠️ 找不到 Auth 用戶: ${uid} (可能已被刪除)，僅更新 Firestore。`);
                    } else {
                        throw e;
                    }
                }
            } catch (e) {
                console.error(`❌ 遷移 ${uid} 失敗:`, e);
            }
        }
        console.log(`🎉 遷移完成！共更新 ${migratedCount} 名有效使用者。`);
    } catch (err) {
        console.error("腳本執行失敗:", err);
    }
    process.exit(0);
}

migrateRoles();
