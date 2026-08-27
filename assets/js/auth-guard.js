// assets/js/auth-guard.js

// Jalankan pengecekan segera setelah skrip dimuat
if (sessionStorage.getItem('isLoggedIn') !== 'true') {
    alert("Akses ditolak. Silakan login melalui portal utama.");
    // Lempar kembali ke halaman login (naik 1 tingkat ke folder root)
    window.location.href = '../index.html';
}

// (Opsional) Keamanan ekstra: Cegah Panitera membuka aplikasi Jadwal
const currentPath = window.location.pathname;
const userRole = sessionStorage.getItem('role');

if (userRole === 'panitera' && currentPath.includes('/jadwal/')) {
    alert("Panitera tidak memiliki akses ke halaman jadwal.");
    window.location.href = '../scoring/index.html';
}