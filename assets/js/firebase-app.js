// assets/js/firebase-app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js"; // Disiapkan untuk aplikasi scoring nanti

// =========================================================
// 1. CONFIG PROJECT A (REALTIME DATABASE - DRAWING/URUTAN)
// =========================================================
const rtdbConfig = {
    apiKey: "AIzaSyA63UtPlhEdC9qKmmHVpDjGv_4RqWjK47k",
    authDomain: "mass-pro-turnamen.firebaseapp.com",
    projectId: "mass-pro-turnamen",
    databaseURL: "https://mass-pro-turnamen-default-rtdb.asia-southeast1.firebasedatabase.app/",
    storageBucket: "mass-pro-turnamen.firebasestorage.app",
    messagingSenderId: "268290671498",
    appId: "1:268290671498:web:d55e4960e392f7dfc8fe73"
};

// =========================================================
// 2. CONFIG PROJECT B (FIRESTORE - MASTER PENDAFTARAN & USER)
// =========================================================
const firestoreConfig = {
    apiKey: "AIzaSyD0MSNQBRpfZBzRgMdz726lnB5YX_TnLpo",
    authDomain: "integrasi-sistem-kempo.firebaseapp.com",
    projectId: "integrasi-sistem-kempo",
    storageBucket: "integrasi-sistem-kempo.firebasestorage.app",
    messagingSenderId: "255724075177",
    appId: "1:255724075177:web:c54fa5dee560b66e1611b8"
};

// Inisialisasi Project B sebagai default app (karena digunakan untuk login utama)
const appFirestore = initializeApp(firestoreConfig);

// Inisialisasi Project A sebagai secondary app (harus diberi nama khusus, misal: "AppRTDB")
const appRTDB = initializeApp(rtdbConfig, "AppRTDB");

// Ekspor instance Firestore dari Project B (Master Pendaftaran & Users)
export const db = getFirestore(appFirestore);

// Ekspor instance Realtime Database dari Project A (Drawing/Urutan)
export const rtdb = getDatabase(appRTDB);