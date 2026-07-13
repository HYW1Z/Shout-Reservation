import { initializeApp } from 'firebase/app'
import { getDatabase, ref, get, set, onValue } from 'firebase/database'

// ↓↓↓ Firebase 콘솔에서 복사한 config를 여기에 붙여넣으세요 ↓↓↓
const firebaseConfig = {
  apiKey: "AIzaSyBFlxhMVYB0_w-Rg0It2N2fucfblNW0Aew",
  authDomain: "shout-reseravation.firebaseapp.com",
  projectId: "shout-reseravation",
  storageBucket: "shout-reseravation.firebasestorage.app",
  messagingSenderId: "523075446604",
  appId: "1:523075446604:web:31ab49464f6ba1acf151e9",
  databaseURL: "https://shout-reseravation-default-rtdb.asia-southeast1.firebasedatabase.app"
}
// ↑↑↑ 여기까지 ↑↑↑

const app = initializeApp(firebaseConfig)
const db = getDatabase(app)

// window.storage 와 동일한 인터페이스로 래핑
export const storage = {
  async get(key) {
    const snap = await get(ref(db, keyToPath(key)))
    if (!snap.exists()) throw new Error('not found')
    return { value: snap.val() }
  },
  async set(key, value) {
    await set(ref(db, keyToPath(key)), value)
    return { value }
  },
  subscribe(key, callback) {
    return onValue(ref(db, keyToPath(key)), snap => {
      callback(snap.exists() ? snap.val() : null)
    })
  }
}

// Firebase path는 '.' ':' 불가 → 변환
function keyToPath(key) {
  return key.replace(/:/g, '/').replace(/\./g, '_')
}
