// assets/js/global-event.js

// KUNCI UTAMA: window.location.origin otomatis mendeteksi URL saat ini
// Jika diakses via HP Wasit (http://192.168.1.15:3000), BASE_URL akan menjadi itu.
// Jika diakses via Laptop Master (http://localhost:3000), BASE_URL akan menyesuaikan.
const BASE_URL = window.location.origin;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Tarik data konfigurasi dari server master
        const response = await fetch(`${BASE_URL}/api/config`);

        if (response.ok) {
            const data = await response.json();

            // 1. Ubah Judul Event di Header (Jika elemennya ada)
            const headerElement = document.getElementById('headerEventName');
            if (headerElement) {
                headerElement.innerText = data.eventName.toUpperCase();
            }

            // 2. Ubah Tanggal/Lokasi di Header (Jika elemennya ada)
            const locationElement = document.getElementById('headerEventLocation');
            if (locationElement) {
                locationElement.innerText = `${data.eventLocation} | ${formatTanggal(data.eventDate)}`;
            }

            // Simpan info event ke LocalStorage sementara (opsional, berguna untuk fitur cetak form)
            localStorage.setItem('currentEvent', JSON.stringify(data));
        }
    } catch (error) {
        console.error("Gagal terhubung ke Server Master. Pastikan Anda satu jaringan WiFi.", error);
    }
});

// Fungsi kecil pemanis untuk format tanggal
function formatTanggal(tanggal) {
    if (!tanggal) return '';
    const date = new Date(tanggal);
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}