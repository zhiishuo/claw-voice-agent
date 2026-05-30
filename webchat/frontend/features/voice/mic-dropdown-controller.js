import { $, qsa } from "../../core/dom.js";
import { STORAGE_KEYS, readLocal, writeLocal } from "../../core/storage.js";

export function initMicDropdown() {
  const micDropdownBtn = $("mic-dropdown-btn");
  const micDropdownMenu = $("mic-dropdown-menu");
  const micChevron = $("mic-chevron");
  const currentMicName = $("current-mic-name");
  let isMicMenuOpen = false;
  let selectedDeviceId = readLocal(STORAGE_KEYS.micDevice, "");

  function close() {
    if (!isMicMenuOpen) return;
    isMicMenuOpen = false;
    micDropdownMenu.classList.remove("opacity-100", "translate-y-0");
    micDropdownMenu.classList.add("opacity-0", "translate-y-2");
    micChevron.classList.remove("rotate-180");
    setTimeout(() => {
      if (!isMicMenuOpen) micDropdownMenu.classList.add("hidden");
    }, 200);
  }

  function open() {
    isMicMenuOpen = true;
    micDropdownMenu.classList.remove("hidden");
    void micDropdownMenu.offsetWidth;
    micDropdownMenu.classList.remove("opacity-0", "translate-y-2");
    micDropdownMenu.classList.add("opacity-100", "translate-y-0");
    micChevron.classList.add("rotate-180");
    refreshDeviceList();
  }

  async function refreshDeviceList() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      renderDeviceOptions(audioInputs);
    } catch (err) {
      console.warn("无法枚举音频设备:", err);
    }
  }

  function renderDeviceOptions(devices) {
    // Keep the header, remove old options
    const header = micDropdownMenu.querySelector(".px-3.py-2");
    micDropdownMenu.innerHTML = "";
    if (header) micDropdownMenu.appendChild(header);
    else {
      const hdr = document.createElement("div");
      hdr.className = "px-3 py-2 text-[11px] font-semibold text-gray-400 bg-gray-50/50";
      hdr.textContent = "选择音频输入设备";
      micDropdownMenu.appendChild(hdr);
    }

    if (!devices.length) {
      const empty = document.createElement("div");
      empty.className = "px-3 py-2 text-xs text-gray-400";
      empty.textContent = "未检测到麦克风设备";
      micDropdownMenu.appendChild(empty);
      return;
    }

    devices.forEach((device) => {
      const btn = document.createElement("button");
      const label = device.label || `麦克风 ${device.deviceId.slice(0, 8)}...`;
      const isSelected = device.deviceId === selectedDeviceId || (!selectedDeviceId && device === devices[0]);

      btn.className = `mic-option w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-between gap-2 group`;
      btn.dataset.deviceId = device.deviceId;
      btn.innerHTML = `
        <span class="break-all leading-snug">${label}</span>
        <i class="fa-solid fa-check text-blue-500 flex-shrink-0 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-30"} option-check transition-opacity"></i>
      `;

      btn.addEventListener("click", () => {
        selectDevice(device.deviceId, label);
        close();
      });

      micDropdownMenu.appendChild(btn);
    });

    // Update current mic name display
    const selected = devices.find((d) => d.deviceId === selectedDeviceId);
    if (selected && selected.label) {
      if (currentMicName) currentMicName.textContent = selected.label;
    } else if (devices.length && !selectedDeviceId) {
      if (currentMicName) currentMicName.textContent = devices[0].label || "默认麦克风";
    }
  }

  function selectDevice(deviceId, label) {
    selectedDeviceId = deviceId;
    writeLocal(STORAGE_KEYS.micDevice, deviceId);

    // Update UI
    if (currentMicName) currentMicName.textContent = label;

    // Update check icons
    qsa(".mic-option").forEach((opt) => {
      const check = opt.querySelector(".option-check");
      if (opt.dataset.deviceId === deviceId) {
        check?.classList.remove("opacity-0", "group-hover:opacity-30");
        check?.classList.add("opacity-100");
      } else {
        check?.classList.remove("opacity-100");
        check?.classList.add("opacity-0", "group-hover:opacity-30");
      }
    });
  }

  micDropdownBtn?.addEventListener("click", () => {
    if (isMicMenuOpen) close();
    else open();
  });

  return {
    close,
    getSelectedDeviceId: () => selectedDeviceId,
    refresh: refreshDeviceList,
  };
}
