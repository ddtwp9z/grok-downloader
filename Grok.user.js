// ==UserScript==
// @name         Grok - Thời trang
// @namespace    https://github.com/ddtwp9z/grok-downloader
// @version      1.0.0
// @description  Auto create multiple videos from one image, upscale to HD and auto rename by image filename
// @match        https://grok.com/imagine*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=grok.com
// @grant        GM_download
// @updateURL    https://raw.githubusercontent.com/ddtwp9z/grok-downloader/main/Grok.user.js
// @downloadURL  https://raw.githubusercontent.com/ddtwp9z/grok-downloader/main/Grok.user.js
// ==/UserScript==


(function () {
    'use strict';

    // ===== CONFIG =====
    const PROMPT =
        "Người mẫu nâng điện thoại lên bằng một động tác tinh tế, sau đó hạ xuống nhẹ nhàng, chuyển động camera làm nổi bật tỷ lệ của bộ trang phục trong khi vẫn giữ nguyên góc nhìn qua gương và giữ đúng chi tiết trang phục cô gái đang mặc. Tuyệt đối không được lỗi tay và không được lỗi chân. Lấy lại góc quay toàn cảnh gương, tạo dáng tự nhiên trong khi cầm điện thoại, tay có một số cử chỉ nhẹ nhàng đáng yêu, thêm một chút chuyển động chậm (slow motion) để tạo nét thanh lịch, tuyệt đối không thay đổi chi tiết trang phục. Người mẫu bước đi chậm rãi, vừa đi vừa phô diễn diện mạo của bộ trang phục đang mặc, không làm thay đổi chi tiết trang phục.";

    const VIDEO_COUNT_PER_IMAGE = 3;

    let IMAGE_QUEUE = [];
    let CURRENT_IMAGE_INDEX = 0;

    // ===== UTILS =====
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function waitForPostPage(timeout = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (location.href.includes("/imagine/post/")) return true;
            await sleep(300);
        }
        return false;
    }

    async function waitForPromptBox(timeout = 20000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el =
                document.querySelector('textarea[aria-label="Tạo video"]') ||
                document.querySelector('textarea[placeholder*="video"]');
            if (el && el.offsetParent !== null) return el;
            await sleep(300);
        }
        return null;
    }

    function setNativeValue(el, value) {
        const setter = Object.getOwnPropertyDescriptor(
            el.__proto__,
            "value"
        )?.set;
        setter.call(el, value);
    }

    function humanClick(el) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        ["pointerdown", "mousedown", "mouseup", "click"].forEach(type => {
            el.dispatchEvent(
                new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: y,
                    button: 0
                })
            );
        });
    }

    // ===== VIDEO ACTIONS =====
    async function sendPrompt(i = 1) {
        if (i === 1) {
            const box = await waitForPromptBox();
            if (!box) throw "Không tìm thấy prompt box";

            box.focus();
            await sleep(50);

            setNativeValue(box, "");
            box.dispatchEvent(new Event("input", { bubbles: true }));

            setNativeValue(box, PROMPT);
            box.dispatchEvent(new Event("input", { bubbles: true }));

            box.blur();
            await sleep(200);
        }

        const createBtn = document.querySelector(
            'button[aria-label="Tạo video"], button[aria-label="Create video"]'
        );
        if (!createBtn || createBtn.offsetParent === null) {
            throw "❌ Không tìm thấy nút Tạo video";
        }

        humanClick(createBtn);
    }

    async function clickUpscaleMenu(timeout = 20000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const openMenu = document.querySelector(
                'div[role="menu"][data-state="open"]'
            );
            if (!openMenu) {
                await sleep(300);
                continue;
            }

            const items = [...openMenu.querySelectorAll('[role="menuitem"]')];
            const upscale = items.find(el => {
                const text = el.textContent?.trim();
                if (text !== "Nâng cấp video") return false;
                if (
                    el.getAttribute("aria-disabled") === "true" ||
                    el.classList.contains("opacity-50") ||
                    el.classList.contains("pointer-events-none")
                ) return false;
                return true;
            });

            if (upscale) {
                upscale.click();
                return true;
            }
            await sleep(300);
        }
        return false;
    }

    async function waitVideoReady(timeout = 120000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const skipBtn = [...document.querySelectorAll("button")]
                .find(b => b.textContent.trim() === "Bỏ qua");

            if (skipBtn && skipBtn.offsetParent !== null) {
                skipBtn.click();
                await sleep(800);
                continue;
            }

            const moreBtn = document.querySelector(
                'button[aria-label="Tùy chọn khác"], button[aria-label="More"]'
            );

            if (
                moreBtn &&
                moreBtn.offsetParent !== null &&
                !moreBtn.closest(".pointer-events-none")
            ) {
                return moreBtn;
            }
            await sleep(400);
        }
        throw "⏰ Timeout: video chưa ready";
    }

    async function waitUpscaleFinishedByHD(timeout = 180000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const hd = [...document.querySelectorAll("div")]
                .find(el => el.textContent.trim() === "HD");
            if (hd) return true;
            await sleep(1500);
        }
        throw "⏰ Upscale chưa xong";
    }

    function isVideoAlreadyHD() {
        return [...document.querySelectorAll("div")]
            .some(el => el.textContent?.trim() === "HD");
    }

    // ===== IMAGE FLOW =====
    async function uploadSingleImage(file) {
        const input = document.querySelector('input[type="file"]');
        if (!input) throw "Không tìm thấy input upload";

        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function getCurrentVideoUrl() {
         const hdVideo = document.querySelector(
             'video#hd-video[src]:not([style*="visibility: hidden"])'
         );
        return hdVideo?.src || null;
    }

    function downloadVideo(url, filename) {
        return new Promise((resolve, reject) => {
            GM_download({
                url,
                name: filename,
                saveAs: false,
                onload: resolve,
                onerror: reject
            });
        });
    }

    function imageToVideoName(file) {
        return file.name.replace(/\.[^/.]+$/, ".mp4");
    }

    async function processOneImage(file) {
        console.log("🖼 Upload ảnh:", file.name);

        await uploadSingleImage(file);
        if (!await waitForPostPage()) throw "Không vào được post page";

        for (let i = 1; i <= VIDEO_COUNT_PER_IMAGE; i++) {
            console.log(`🎬 Video ${i} cho ảnh ${file.name}`);

            await sendPrompt(i);
            await sleep(5000);

            const moreBtn = await waitVideoReady();

            if (!isVideoAlreadyHD()) {
                humanClick(moreBtn);
                await sleep(800);
                if (await clickUpscaleMenu()) {
                    await waitUpscaleFinishedByHD();
                }
            }

            const videoUrl = getCurrentVideoUrl();
            if (videoUrl) {
                const filename = imageToVideoName(file);
                await downloadVideo(videoUrl, filename);
            }
            await sleep(1500);
        }
    }

    async function selectMultipleImages() {
        return new Promise(resolve => {
            const input = document.querySelector('input[type="file"]');
            if (!input) return resolve([]);

            input.setAttribute("multiple", "multiple");
            input.addEventListener(
                "change",
                () => resolve([...input.files]),
                { once: true }
            );
            input.click();
        });
    }

    async function goBackToUpload() {
        const logo = document.querySelector('a[href="/imagine"]');
        if (!logo) throw "Không tìm thấy nút Imagine";
        humanClick(logo);
        await sleep(2000);
    }

    // ===== MAIN =====
    async function run() {
        IMAGE_QUEUE = await selectMultipleImages();
        if (!IMAGE_QUEUE.length) return alert("❌ Không có ảnh");

        for (let i = 0; i < IMAGE_QUEUE.length; i++) {
            CURRENT_IMAGE_INDEX = i;
            try {
                await processOneImage(IMAGE_QUEUE[i]);
            } catch (e) {
                console.error("❌ Lỗi ảnh:", e);
            }
            await goBackToUpload();
            await sleep(2000);
        }

        alert("🎉 DONE");
    }

    // ===== UI BUTTON =====
    const btn = document.createElement("button");
    btn.textContent = "▶ Start";
    Object.assign(btn.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 99999,
        padding: "10px 14px",
        background: "#00c853",
        color: "#000",
        fontWeight: "bold",
        borderRadius: "8px",
        cursor: "pointer"
    });
    btn.onclick = run;
    document.body.appendChild(btn);

})();