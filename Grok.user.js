// ==UserScript==
// @name         Grok - Thời trang
// @namespace    https://github.com/ddtwp9z/grok-downloader
// @version      1.0.3
// @description  Auto create multiple videos from one image, upscale to HD and auto rename by image filename
// @match        https://grok.com/imagine*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=grok.com
// @grant        GM_download
// @updateURL    https://raw.githubusercontent.com/ddtwp9z/grok-downloader/main/Grok.user.js
// @downloadURL  https://raw.githubusercontent.com/ddtwp9z/grok-downloader/main/Grok.user.js
// ==/UserScript==


(function () {
    'use strict';
    // 1️⃣ SILENCE AbortError (media bị unmount khi React rerender)
    window.addEventListener("unhandledrejection", e => {
        if (e.reason?.name === "AbortError") {
            e.preventDefault();
            return;
        }
    });

    // 2️⃣ Chặn video tự play lại khi DOM sắp bị remove
    const stopAllVideos = () => {
        document.querySelectorAll("video").forEach(v => {
            try {
                v.pause();
                v.removeAttribute("autoplay");
            } catch (_) { }
        });
    };
    // ===== CONFIG =====
    const PROMPT = `
                Chuyển động camera làm nổi bật tỷ lệ của bộ trang phục trong khi vẫn giữ nguyên góc nhìn qua gương và giữ đúng chi tiết trang phục cô gái đang mặc. Tuyệt đối không được lỗi tay và không được lỗi chân. Lấy lại góc quay toàn cảnh gương mà không thêm bất kì chi tiết trang phục nào ngoài bức ảnh, tạo dáng tự nhiên trong khi cầm điện thoại, điện thoại vẫn luôn che mặt cô gái, tay có một số cử chỉ nhẹ nhàng đáng yêu, thêm một chút chuyển động chậm (slow motion) để tạo nét thanh lịch, tuyệt đối không thay đổi chi tiết trang phục.Người mẫu bước đi chậm rãi, vừa đi vừa phô diễn diện mạo của bộ trang phục đang mặc, không làm thay đổi chi tiết trang phục như trong ảnh mẫu.

                Chuyển động camera làm nổi bật tỷ lệ của bộ trang phục trong khi vẫn giữ nguyên góc nhìn qua gương và giữ đúng chi tiết trang phục cô gái đang mặc. Tuyệt đối không được lỗi tay và không được lỗi chân. Lấy lại góc quay toàn cảnh gương mà không thêm bất kì chi tiết trang phục nào ngoài bức ảnh, tạo dáng tự nhiên trong khi cầm điện thoại, tay cầm điện thoại vẫn luôn che mặt cô gái, tay còn lại có một số cử chỉ như vuốt mái tóc, sau đó đưa tay ra trước bụng một cách thanh lịch, sau đó tay vuốt dọc để xuôi xuống ở tư thế bình thường, thêm một chút chuyển động chậm (slow motion) để tạo nét thanh lịch, tuyệt đối không thay đổi chi tiết trang phục. Tuyệt đối không làm thay đổi chi tiết trang phục như trong ảnh mẫu.

                Chuyển động camera làm nổi bật tỷ lệ của bộ trang phục trong khi vẫn giữ nguyên góc nhìn qua gương và giữ đúng chi tiết trang phục cô gái đang mặc. Tuyệt đối không được lỗi tay và không được lỗi chân. Lấy lại góc quay toàn cảnh gương mà không thêm bất kì chi tiết trang phục nào ngoài bức ảnh, tạo dáng tự nhiên trong khi cầm điện thoại, tay cầm điện thoại vẫn luôn che mặt cô gái, đầu cô gái hơi nghiêng nhẹ rồi mỉm cười rồi sau đó cô đứng về tư thế bình thường ngay lập tức, một tay còn lại của cô gái để khoanh tay trước ngực một cách cá tính khoảng 1.5 giây, sau đó đưa tay chống vào hông, giữ nguyên tư thế này đến hết video, thêm một chút chuyển động chậm (slow motion) để tạo nét thanh lịch, tuyệt đối không thay đổi chi tiết trang phục. Tuyệt đối không làm thay đổi chi tiết trang phục như trong ảnh mẫu.
                `;
    function splitPromptList(promptText) {
        return promptText
            .split(/\n\s*\n/)
            .map(p => p.trim())
            .filter(Boolean);
    }

    const PROMPT_LIST = splitPromptList(PROMPT);
    const VIDEO_COUNT_PER_IMAGE = 3;

    let IMAGE_QUEUE = [];
    let CURRENT_IMAGE_INDEX = 0;

    // ===== UTILS =====
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function waitForPostPage(timeout = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (location.href.includes("/imagine/post/")) return true;
            await sleep(300);
        }
        return false;
    }

    function getPromptForVideo(videoIndex) {
        if (PROMPT_LIST.length === 0) {
            throw "❌ Prompt list rỗng";
        }

        if (videoIndex < PROMPT_LIST.length) {
            return PROMPT_LIST[videoIndex];
        }

        // nếu vượt quá số prompt → dùng prompt cuối
        return PROMPT_LIST[PROMPT_LIST.length - 1];
    }


    async function waitForPromptBox(timeout = 20000) {
        console.log("waitForPromptBox");
        const start = Date.now();

        while (Date.now() - start < timeout) {

            const editors = document.querySelectorAll(
                'div[contenteditable="true"].ProseMirror'
            );

            for (const el of editors) {
                const placeholder = el.querySelector('[data-placeholder]');
                if (
                    placeholder &&
                    placeholder.getAttribute("data-placeholder")?.includes("Gõ để tưởng tượng") &&
                    el.offsetParent !== null
                ) {
                    console.log("Tìm thấy prompt box");
                    return el;
                }
            }

            await sleep(300);
        }
        console.log("Không tìm thấy prompt box");
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
    async function fillPrompt(promptText) {
        const box = await waitForPromptBox();
        if (!box) throw "Không tìm thấy prompt box";

        box.focus();
        await sleep(100);

        // Xóa nội dung cũ
        box.innerHTML = "<p></p>";
        box.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(100);

        // Set nội dung mới
        box.innerHTML = `<p>${promptText.replace(/\n/g, "<br>")}</p>`;
        box.dispatchEvent(new Event("input", { bubbles: true }));

        await sleep(100);
    }

    async function clickCreateVideo() {
        const btn = document.querySelector(
            'button[aria-label="Tạo video"], button[aria-label="Create video"]'
        );
        if (!btn || btn.offsetParent === null) {
            throw "❌ Không tìm thấy nút Tạo video";
        }
        console.log("Click button Tạo video");
        humanClick(btn);
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

    async function waitTaskReady(timeout = 120000) {
        const start = Date.now();

        while (Date.now() - start < timeout) {

            // 1️⃣ Nếu còn trạng thái "Đang tạo" → tiếp tục chờ
            const creating = [...document.querySelectorAll("span")]
                .find(el => el.textContent?.trim() === "Đang tạo");

            if (creating) {
                await sleep(800);
                continue;
            }

            // 2️⃣ Khi không còn "Đang tạo" → tìm nút More
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

        // 1️⃣ Ưu tiên đúng video HD
        const hdVideo = document.querySelector('video#hd-video[src]');

        if (hdVideo && hdVideo.src && hdVideo.src.includes("_hd.mp4")) {
            return hdVideo.src.split("?")[0]; // bỏ query cache
        }

        // 2️⃣ Fallback: tìm bất kỳ video nào có _hd.mp4
        const fallback = [...document.querySelectorAll("video[src]")]
            .find(v => v.src.includes("_hd.mp4"));

        if (fallback) {
            return fallback.src.split("?")[0];
        }

        return null;
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

    // ===== NEW GROK UI FLOW =====
    async function openSettingMenu(timeout = 15000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const btn = document.querySelector('button[aria-label="Cài đặt"]');
            if (btn && btn.offsetParent !== null) {
                humanClick(btn);
                await sleep(500);
                return true;
            }
            await sleep(300);
        }
        throw "❌ Không tìm thấy nút Cài đặt";
    }

    async function waitForMenuOpen(timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const menu = document.querySelector('div[role="menu"][data-state="open"]');
            if (menu) return menu;
            await sleep(300);
        }
        throw "❌ Menu không mở";
    }

    async function selectAspect916(menu) {
        console.log("selectAspect916");
        const btn = menu.querySelector('button[aria-label="9:16"]');
        if (!btn) throw "❌ Không tìm thấy nút 9:16";
        humanClick(btn);
        await sleep(300);
    }

    async function clickCreateVideoInMenu(menu) {
        console.log("clickCreateVideoInMenu");
        const create = [...menu.querySelectorAll('[role="menuitem"]')]
            .find(item =>
                item.querySelector('span') &&
                item.querySelector('span').textContent.trim().includes("Tạo video")
            );

        if (!create) throw "❌ Không tìm thấy menu Tạo video";
        humanClick(create);
        await sleep(800);
    }

    async function triggerCreateVideoFromImage() {
        await openSettingMenu();
        const menu = await waitForMenuOpen();
        await selectAspect916(menu);
        await clickCreateVideoInMenu(menu);
    }

    async function goBackToUpload() {
        const logo = document.querySelector('a[href="/imagine"]');
        if (!logo) throw "Không tìm thấy nút Imagine";
        humanClick(logo);
        await sleep(1000);
    }

    async function processOneImage(file) {
        console.log("🖼 Xử lý ảnh:", file.name);

        for (let i = 0; i < VIDEO_COUNT_PER_IMAGE; i++) {
            console.log(`🎬 Video ${i + 1}/${VIDEO_COUNT_PER_IMAGE} cho ảnh ${file.name}`);

            const promptNow = getPromptForVideo(i);
            console.log("📝 Prompt:", promptNow);

            // 1️⃣ upload ảnh
            let uploaded = false;

            for (let retry = 1; retry <= 3; retry++) {
                console.log(`🔁 Upload thử lần ${retry}:`, file.name);

                await uploadSingleImage(file);

                if (await waitForPostPage(5000)) {
                    uploaded = true;
                    console.log("✅ Upload OK");
                    break;
                }

                console.warn("⚠ Không vào được post page, thử lại...");
                await goBackToUpload();
                await sleep(1500);
            }

            if (!uploaded) {
                throw "❌ Upload thất bại sau 3 lần";
            }

            await sleep(2000);
            await triggerCreateVideoFromImage();

            // 3️⃣ fill prompt
            await fillPrompt(promptNow);

            // 4️⃣ tạo video
            await clickCreateVideo();

            // 5️⃣ đợi video xong
            await sleep(2000);
            const moreBtn = await waitTaskReady();

            // 6️⃣ upscale nếu cần
            if (!isVideoAlreadyHD()) {
                humanClick(moreBtn);
                await sleep(800);
                if (await clickUpscaleMenu()) {
                    await waitUpscaleFinishedByHD();
                }
            }

            // 7️⃣ download
            const videoUrl = getCurrentVideoUrl();
            console.log("📝 URL:", videoUrl);
            if (videoUrl) {
                const filename =
                    file.name.replace(/\.[^/.]+$/, `_${i + 1}.mp4`);
                await downloadVideo(videoUrl, filename);
            }

            // 8️⃣ quay về upload để làm video tiếp
            await goBackToUpload();
            await sleep(1000);
        }
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



