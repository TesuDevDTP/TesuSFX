<div align="center">

  <img src="2. banner.pngbanner.png" alt="Tesu SFX Banner" width="100%" style="border-radius: 8px; margin-bottom: 20px;"/>

  # TESU SFX

  **Thư viện Sound Effects và Music trực tiếp trong Adobe Premiere Pro — tìm kiếm, nghe thử và quản lý âm thanh nhanh hơn ngay trong quy trình dựng.**

  *Thiết kế và phát triển bởi **TESU***

  [![Phiên bản](https://img.shields.io/badge/Version-v1.0.0-00A3FF?style=for-the-badge)](https://github.com/TesuDevDTP/tesu-sfx-panel/releases)
  [![Nền tảng](https://img.shields.io/badge/Platform-Adobe_Premiere_Pro-11192E?style=for-the-badge&logo=adobepremierepro)](https://www.adobe.com/products/premiere.html)
  [![Hệ điều hành](https://img.shields.io/badge/OS-Windows-060B14?style=for-the-badge&logo=windows)](https://www.microsoft.com/windows)

</div>

---

## 🎧 Tổng Quan

**Tesu SFX** là một panel mở rộng dành cho **Adobe Premiere Pro**, được xây dựng để đưa thư viện Sound Effects và Music vào ngay bên trong môi trường dựng phim.

Thay vì phải liên tục chuyển qua lại giữa Premiere Pro, File Explorer và các thư mục âm thanh để tìm hiệu ứng phù hợp, editor có thể:

- Duyệt thư viện SFX hoặc Music theo danh mục
- Tìm kiếm âm thanh nhanh chóng
- Nghe thử trực tiếp
- Quản lý âm thanh yêu thích
- Lựa chọn track đang làm việc.

Mục tiêu của dự án là giảm tối đa những thao tác không cần thiết trong quá trình sound design và giữ editor ở trong **một workflow duy nhất**.

---

## ✨ Tính Năng

### 🔎 Tìm Kiếm Sound Effects

Tìm kiếm trực tiếp trong thư viện âm thanh bằng tên hoặc từ khóa.

```text
Tìm kiếm âm thanh...
```

Giúp nhanh chóng lọc ra hiệu ứng cần sử dụng thay vì phải mở từng thư mục trên máy tính.

### 📚 Thư Viện Theo Danh Mục

Âm thanh được tổ chức thành các nhóm để dễ duyệt và quản lý:

```text
Animals
Build Up
Cinematic
Ambient Sounds
Cracks & Slices
...
```

Các danh mục có thể mở rộng theo thư viện SFX của người dùng.

### ▶️ Preview Âm Thanh

Mỗi âm thanh được hiển thị dưới dạng card riêng với:

- Tên file
- Định dạng âm thanh
- Waveform/icon đại diện
- Nút preview
- Trạng thái yêu thích.

Editor có thể nghe thử trước khi quyết định sử dụng.

### ⭐ Favorites

Đánh dấu những âm thanh thường xuyên sử dụng để truy cập nhanh hơn trong các dự án sau.

### 🎚️ Track Selection

Cho phép lựa chọn track âm thanh đang làm việc trực tiếp từ panel:

```text
Track Cuối
Track Âm Thanh 1
Track Âm Thanh 2
Track Âm Thanh 3
Track Âm Thanh 4
```

Thiết kế này hướng tới workflow dựng phim thực tế, nơi editor thường cần phân loại SFX theo từng track trên timeline.

### 🔊 Audio Control

Panel cung cấp điều khiển âm thanh trực tiếp để editor có thể preview SFX mà không cần rời khỏi Premiere Pro.

### 🎵 SOUNDFX / MUSIC

Tách riêng hai nhóm nội dung:

```text
SOUNDFX
MUSIC
```

giúp chuyển đổi nhanh giữa hiệu ứng âm thanh và thư viện nhạc.

---


## 🎬 Workflow

Workflow cơ bản:

```text
1. Mở Tesu SFX trong Adobe Premiere Pro
                ↓
2. Chọn danh mục
                ↓
3. Tìm kiếm / duyệt Sound Effect
                ↓
4. Preview âm thanh
                ↓
5. Chọn track cần sử dụng
                ↓
6. Đưa âm thanh vào workflow dựng
```

Mục tiêu là biến việc tìm SFX từ một thao tác quản lý file thành một phần tự nhiên của quá trình dựng.

---


## ⚙️ Cài Đặt

### Yêu cầu

- Windows 10 / Windows 11
- Adobe Premiere Pro hỗ trợ CEP extension
- Thư viện Sound Effects được cấu hình cho panel

### Cài đặt thủ công

Clone repository:

```bash
git clone https://github.com/TesuDevDTP/tesu-sfx-panel.git
```

Sau đó đặt extension vào thư mục CEP extensions tương ứng của Adobe.
```bash
C:\Program Files (x86)\Common Files\Adobe\CEP\extensions
```

Bật Developer Mode cho CEP nếu đang chạy phiên bản extension chưa được ký.

> **Lưu ý:** đường dẫn cài đặt CEP có thể thay đổi tùy phiên bản Adobe và cấu hình hệ thống.

---

## 🤝 Đóng Góp

Mọi đóng góp liên quan đến:

- Tổ chức thư viện
- Tối ưu giao diện
- Cải thiện workflow
- Tìm kiếm Sound Effects
- Tương thích Premiere Pro
- Sửa lỗi hoặc cải thiện hiệu năng

đều được hoan nghênh.

Bạn có thể mở **Issue** để báo lỗi hoặc đề xuất tính năng, hoặc gửi **Pull Request** nếu muốn trực tiếp đóng góp code.

---

## 📞 Liên Hệ

**Nhà phát triển:** TESU

**GitHub:** [@TesuDevDTP](https://github.com/TesuDevDTP)

**Email:** dothanhphat.tesu@gmail.com

---

## 📄 Bản Quyền

Dự án này được cấp phép theo các điều khoản của MIT License. Bạn được toàn quyền sử dụng, sửa đổi, sao chép và phân phối lại phần mềm này cho các mục đích cá nhân hoặc thương mại, miễn là đính kèm tệp bản quyền gốc của nhà phát triển.
