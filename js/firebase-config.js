/**
 * WealthSim Pro - Firebase Service & Configuration
 * ไฟล์นี้กำหนดการเชื่อมต่อและโครงสร้าง Path/Collection ใน Firebase (รองรับทั้ง Realtime Database และ Firestore)
 * สำหรับการนำไปใช้อ้างอิงภายนอก (External Integration)
 */

// 1. ใส่ค่าคอนฟิก Firebase ของคุณที่นี่
const firebaseConfig =
{
    apiKey: "AIzaSyAciknEYhZU7AwOdfYytC1t_AnW2Ee11us",
    authDomain: "faifah-ttb.firebaseapp.com",
    projectId: "faifah-ttb",
    storageBucket: "faifah-ttb.appspot.com",
    messagingSenderId: "842980876200",
    appId: "1:842980876200:web:f33bfad2ccbf263075079d"
};

// 2. การกำหนดโครงสร้างฐานข้อมูลตามภาพ (Database Paths / Collections Reference)
const DB_PATHS = {
    //RM_TEMS: "ONE_Employee", 
    //RM_USERS: "ONE_Login",
    //RM_APPS: "ONE_Application",
    AL_EMPLOYEE: "AL_Employee",
    AL_REWARD: "AL_Reward",
    AL_CONTROL: "AL_Reward" // ชี้ไปที่ AL_Reward เนื่องจาก Security Rules ของ Firebase กำหนดสิทธิ์ไว้เฉพาะ AL_Employee และ AL_Reward
};


let app, db, rtdb, storage;

function initFirebase() {
    if (typeof firebase === 'undefined') {
        console.warn("กรุณาติดตั้ง Firebase SDK ก่อนเรียกใช้งาน ไฟล์นี้เป็นเพียง Path Setup สำหรับงานภายนอก");
        return null;
    }

    // เริ่มทำงาน App
    if (!firebase.apps.length) {
        app = firebase.initializeApp(firebaseConfig);
    } else {
        app = firebase.app();
    }

    try {
        // สำหรับ Firestore (Cloud Database)
        db = firebase.firestore();
    } catch (e) {
        console.log("Firestore ไม่ได้เปิดใช้งาน หรือไม่ได้นำเข้า SDK");
    }

    let auth = null;
    try {
        // สำหรับ Firebase Auth
        if (typeof firebase.auth === 'function') {
            auth = firebase.auth();
        }
    } catch (e) {
        auth = null;
    }

    try {
        // สำหรับ Realtime Database (เฉพาะเมื่อมี databaseURL กำหนดไว้ เพื่อป้องกันการค้างจากการต่อ default RTDB ที่ไม่มีอยู่)
        if (firebaseConfig.databaseURL && typeof firebase.database === 'function') {
            rtdb = firebase.database();
        } else {
            rtdb = null;
        }
    } catch (e) {
        console.log("Realtime Database ไม่ได้เปิดใช้งาน หรือไม่ได้นำเข้า SDK");
        rtdb = null;
    }

    try {
        // สำหรับ Firebase Storage
        if (typeof firebase.storage === 'function') {
            storage = firebase.storage();
        }
    } catch (e) {
        console.log("Firebase Storage ไม่ได้เปิดใช้งาน หรือไม่ได้นำเข้า SDK");
    }

    return { app, db, rtdb, storage, auth };
}

// Global Exports
if (typeof window !== 'undefined') {
    window.firebaseConfig = firebaseConfig;
    window.DB_PATHS = DB_PATHS;
    window.initFirebase = initFirebase;
}

