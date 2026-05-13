import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
    AlertTriangle,
    Cpu,
    Eye,
    EyeOff,
    FolderOpen,
    Gamepad2,
    Heart,
    Keyboard,
    Loader2,
    Mouse,
    PenLine,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    SlidersHorizontal,
    Trash2,
    Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type BindingFile = {
    name: string;
    path: string;
    source: string;
    editable?: boolean;
};

type DeviceKind = "keyboard" | "mouse" | "joystick" | "gamepad" | "unknown";

type DeviceInfo = {
    id: string;
    name: string;
    kind: DeviceKind;
    instance?: string;
    bindingCount: number;
};

type HardwareDevice = {
    id: string;
    slot?: number;
    name: string;
    kind: DeviceKind;
    source: "browser" | "windows";
    virtualDevice?: boolean;
    status?: string;
    buttons: number;
    axes: number;
};

type CapturedGamepadInput = {
    input: string;
    deviceId: string;
    deviceName: string;
    deviceKind: DeviceKind;
};

type BindingInput = {
    input: string;
    deviceId: string;
    deviceKind: DeviceKind;
};

type BindingRow = {
    id: string;
    actionName: string;
    actionLabel: string;
    actionMap: string;
    bindings: BindingInput[];
    deviceId: string;
    deviceKind: DeviceKind;
    hasBinding: boolean;
    canEditCurve: boolean;
};

type ParsedBindings = {
    rows: BindingRow[];
    devices: DeviceInfo[];
    actionMapCount: number;
};

type CurveDraft = {
    exponent: number;
    deadzone: number;
    saturation: number;
};

const ALL_DEVICES = "all";
const NO_DEVICE = "none";
const BASE_PROFILE_SOURCE = "Base Data.pak";
const USER_PROFILE_PREFIX = "startrad_user_bindings_";
const AUTO_HARDWARE_LINK = "auto";

const EMPTY_INPUTS = new Set(["", "none", "null", "undefined", "unbound", "disabled", "-"]);

const ACTION_LABEL_OVERRIDES: Record<string, string> = {
    v_flightready: "Flight Ready",
    v_self_destruct: "Self Destruct",
    v_lock_all_doors: "Lock All Doors",
    v_unlock_all_doors: "Unlock All Doors",
    v_open_all_doors: "Open All Doors",
    v_close_all_doors: "Close All Doors",
    v_toggle_all_doors: "Toggle All Doors",
    v_lock_all_ports: "Lock All Ports",
    v_unlock_all_ports: "Unlock All Ports",
    v_toggle_all_portlocks: "Toggle All Port Locks",
    v_toggle_all_doorlocks: "Toggle All Door Locks",
    v_view_cycle_fwd: "View Cycle Forward",
    v_view_freelook_mode: "Freelook Mode",
    v_view_interact: "View Interact",
    v_view_mode: "View Mode",
    v_ifcs_speed_limiter_up: "Speed Limiter Up",
    v_ifcs_speed_limiter_down: "Speed Limiter Down",
    v_ifcs_speed_limiter_increment: "Speed Limiter Increment",
    v_ifcs_speed_limiter_decrement: "Speed Limiter Decrement",
    v_ifcs_throttle_set_normal: "Throttle Set Normal",
    v_ifcs_throttle_swap_mode: "Throttle Swap Mode",
    v_ifcs_toggle_esp: "Toggle ESP",
    v_ifcs_toggle_gforce_safety: "Toggle G-Force Safety",
};

const KEY_NAMES: Record<string, string> = {
    lalt: "Left Alt",
    ralt: "Right Alt",
    lctrl: "Left Ctrl",
    rctrl: "Right Ctrl",
    lshift: "Left Shift",
    rshift: "Right Shift",
    space: "Space",
    enter: "Enter",
    escape: "Escape",
    backspace: "Backspace",
    delete: "Delete",
    tab: "Tab",
    up: "Arrow Up",
    down: "Arrow Down",
    left: "Arrow Left",
    right: "Arrow Right",
    mouse1: "Mouse Left",
    mouse2: "Mouse Right",
    mouse3: "Mouse Middle",
    mwheel_up: "Mouse Wheel Up",
    mwheel_down: "Mouse Wheel Down",
};

const AXIS_NAMES: Record<string, string> = {
    x: "X",
    y: "Y",
    z: "Z",
    rotx: "Rot X",
    roty: "Rot Y",
    rotz: "Rot Z",
    slider1: "Slider 1",
    slider2: "Slider 2",
};

const GAMEPAD_NAMES: Record<string, string> = {
    a: "A",
    b: "B",
    x: "X",
    y: "Y",
    start: "Start",
    back: "Back",
    dpad_up: "D-pad Up",
    dpad_down: "D-pad Down",
    dpad_left: "D-pad Left",
    dpad_right: "D-pad Right",
    shoulderl: "Left Shoulder",
    shoulderr: "Right Shoulder",
    triggerl: "Left Trigger",
    triggerr: "Right Trigger",
    triggerl_btn: "Left Trigger",
    triggerr_btn: "Right Trigger",
    thumbl: "Left Stick",
    thumbr: "Right Stick",
    thumblx: "Left Stick X",
    thumbly: "Left Stick Y",
    thumbrx: "Right Stick X",
    thumbry: "Right Stick Y",
};

function isBaseProfile(profile: Pick<BindingFile, "name" | "source"> | null | undefined) {
    return Boolean(
        profile &&
        (profile.source === BASE_PROFILE_SOURCE || profile.name.startsWith("startrad_base_defaultProfile_"))
    );
}

function isGeneratedProfile(profile: Pick<BindingFile, "name"> | null | undefined, version?: string) {
    if (!profile) return false;
    if (version) return profile.name === customProfileFileName(version);
    return profile.name.startsWith(USER_PROFILE_PREFIX);
}

function profileSelectionKey(version: string) {
    return `startrad:bindings:selected-profile:${version || "default"}`;
}

function readStoredProfilePath(version: string) {
    try {
        return window.localStorage.getItem(profileSelectionKey(version)) ?? "";
    } catch {
        return "";
    }
}

function rememberSelectedProfilePath(version: string, path: string) {
    try {
        window.localStorage.setItem(profileSelectionKey(version), path);
    } catch {
        // Ignore storage failures; the editor still works for the current session.
    }
}

function normalizeVersionForFile(version: string) {
    return (version || "LIVE").replace(/[^a-z0-9_.-]/gi, "_").replace(/\.xml$/i, "");
}

function customProfileFileName(version: string) {
    return `${USER_PROFILE_PREFIX}${normalizeVersionForFile(version)}.xml`;
}

function dirname(path: string) {
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return slash >= 0 ? path.slice(0, slash + 1) : "";
}

function basename(path: string) {
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return slash >= 0 ? path.slice(slash + 1) : path;
}

function resolveUserProfilePath(profiles: BindingFile[], baseProfile: BindingFile, version: string) {
    const fileName = customProfileFileName(version);
    const existingCustom = profiles.find((profile) => isGeneratedProfile(profile, version));
    if (existingCustom) return existingCustom.path;
    return `${dirname(baseProfile.path)}${fileName}`;
}

function toErrorMessage(error: unknown, fallback = "Une erreur inattendue est survenue.") {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return fallback;
}

// Match un input qui n'est qu'un préfixe device sans bouton/axe (ex: "js2_", "kb1_",
// "mo1_", "xi1_", "gp1_", ou même juste "js2") → considéré comme vide (action non
// attribuée même si le device est listé dans l'XML).
const DEVICE_PREFIX_ONLY = /^(kb|mo|js|gp|xi|joy|pad|key|mouse|pi)\d*_?$/i;

function cleanBindingInput(value: string | null | undefined) {
    const input = (value ?? "").trim();
    if (EMPTY_INPUTS.has(input.toLowerCase())) return "";
    if (DEVICE_PREFIX_ONLY.test(input)) return "";
    return input;
}

function hasBindingInput(value: string | null | undefined) {
    return cleanBindingInput(value).length > 0;
}

function getAttribute(element: Element, names: string[]) {
    for (const name of names) {
        const value = element.getAttribute(name);
        if (value) return value;
    }
    return "";
}

function directChildren(element: Element, tagName: string) {
    const lower = tagName.toLowerCase();
    return Array.from(element.children).filter((child) => child.tagName.toLowerCase() === lower);
}

function titleCase(value: string) {
    return value
        .split(" ")
        .filter(Boolean)
        .map((part) => {
            const upper = part.toUpperCase();
            if (["IFCS", "ESP", "HUD", "UI", "FPS", "VTOL"].includes(upper)) return upper;
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join(" ");
}

function splitIdentifierWords(value: string) {
    return value
        .replace(/^@ui_?/i, "")
        .replace(/^CI/, "")
        .replace(/^CO/, "")
        .replace(/Desc$/i, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim();
}

function humanizeActionName(actionName: string, labelFromXml?: string) {
    if (labelFromXml && !labelFromXml.startsWith("@")) return labelFromXml;
    if (ACTION_LABEL_OVERRIDES[actionName]) return ACTION_LABEL_OVERRIDES[actionName];
    if (labelFromXml?.startsWith("@")) return titleCase(splitIdentifierWords(labelFromXml));

    const cleaned = actionName
        .replace(/^v_/, "")
        .replace(/^ui_/, "")
        .replace(/^player_/, "")
        .replace(/_/g, " ")
        .replace(/\bifcs\b/gi, "IFCS")
        .replace(/\besp\b/gi, "ESP")
        .replace(/\bhud\b/gi, "HUD");

    return titleCase(cleaned);
}

function inferDeviceKind(inputValue: string): DeviceKind {
    const input = cleanBindingInput(inputValue).toLowerCase();
    if (!input) return "unknown";
    if (/^js\d+_/.test(input)) return "joystick";
    if (/^(xi|xinput|gamepad)\d*[_-]/.test(input)) return "gamepad";
    if (/^kb\d+_/.test(input)) return "keyboard";
    if (input.startsWith("maxis_")) return "mouse";
    if (input.startsWith("mouse") || input.startsWith("mwheel")) return "mouse";
    if (input.includes("mouse")) return "mouse";
    if (input.includes("keyboard")) return "keyboard";
    return "keyboard";
}

function inputDeviceId(inputValue: string) {
    const input = cleanBindingInput(inputValue).toLowerCase();
    const joystick = input.match(/^js(\d+)_/);
    if (joystick) return `joystick:${joystick[1]}`;
    const xinput = input.match(/^(?:xi|xinput|gamepad)(\d*)[_-]/);
    if (xinput) return `gamepad:${xinput[1] || "1"}`;
    if (/^kb\d+_/.test(input)) return "keyboard";
    if (input.startsWith("mouse") || input.startsWith("mwheel") || input.startsWith("maxis_")) return "mouse";
    if (!input) return NO_DEVICE;
    return "keyboard";
}

function deviceNameFromId(id: string, kind: DeviceKind) {
    if (id === "keyboard") return "Keyboard";
    if (id === "mouse") return "Mouse";
    if (id === NO_DEVICE) return "Non attribue";
    const [, instance = "1"] = id.split(":");
    if (kind === "gamepad") return `Gamepad ${instance}`;
    if (kind === "joystick") return `Joystick ${instance}`;
    return "Peripherique";
}

function isGenericDeviceName(name: string, id: string, kind: DeviceKind) {
    return name === deviceNameFromId(id, kind) || /^joystick \d+$/i.test(name) || /^gamepad \d+$/i.test(name);
}

function compactHardwareName(name: string) {
    return name
        .replace(/\s*\((?:STANDARD GAMEPAD|Vendor:|Product:)[^)]+\)/gi, "")
        .replace(/\s+/g, " ")
        .trim() || name;
}

function compactProfileDeviceName(name: string) {
    return name
        .replace(/\s*\{[^}]+\}/g, "")
        .replace(/\s+/g, " ")
        .trim() || name;
}

function isVirtualDeviceName(name: string) {
    const lower = name.toLowerCase();
    return lower.includes("vjoy")
        || lower.includes("virtual")
        || lower.includes("vhf")
        || lower.includes("hidhide");
}

function foldHardwareText(value: string) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isGenericHardwareName(name: string) {
    const lower = foldHardwareText(name);
    return lower.includes("controleur de jeu hid")
        || lower.includes("hid-compliant game controller")
        || lower.includes("game controller hid")
        || lower.includes("controleur systeme hid")
        || lower.includes("peripherique d entree usb")
        || lower.includes("peripherique conforme aux peripheriques d interface utilisateur")
        || lower.includes("peripherique fournisseur hid")
        // Bluetooth HID host : ce n'est pas un device de jeu, c'est juste
        // l'adapteur Bluetooth qui apparait comme un "device HID" cote Windows.
        || lower.includes("peripherique hid bluetooth")
        || lower.includes("hid bluetooth")
        || lower.includes("bluetooth hid")
        || lower.includes("bluetooth low energy")
        || lower === "vjoy driver";
}

function hardwareShortId(hardware: Pick<HardwareDevice, "id">) {
    const vidPid = hardware.id.match(/VID_([0-9a-f]+)&PID_([0-9a-f]+)/i);
    if (vidPid) return `VID ${vidPid[1].toUpperCase()} PID ${vidPid[2].toUpperCase()}`;
    return hardware.id.split("\\").filter(Boolean).pop()?.slice(0, 18) || hardware.id.slice(0, 18);
}

function hardwareOptionLabel(hardware: Pick<HardwareDevice, "id" | "name">) {
    const name = compactHardwareName(hardware.name);
    if (!isGenericHardwareName(name)) return name;
    return `${name} - ${hardwareShortId(hardware)}`;
}

function isAssignablePhysicalHardware(hardware: HardwareDevice) {
    return hardware.source === "windows"
        && !hardware.virtualDevice
        && !isVirtualDeviceName(hardware.name)
        && !isGenericHardwareName(hardware.name);
}

function isLinkablePhysicalHardware(hardware: HardwareDevice) {
    // Accepte windows (Get-PnpDevice) ET browser (gilrs / navigator.getGamepads).
    // Les entrees gilrs ont un id "native:<slot>:<name>" qui match les captures
    // d'input. Le filtre auto-create exclut explicitement les gilrs pour ne
    // pas creer des cards en double (PnP + gilrs).
    return (hardware.source === "windows" || hardware.source === "browser")
        && !hardware.virtualDevice
        && !isVirtualDeviceName(hardware.name)
        && !isGenericHardwareName(hardware.name);
}

function hardwareSideFromName(name: string) {
    const lower = foldHardwareText(name);
    if (!lower.includes("sol-r")) return null;
    if (lower.includes("[l]") || lower.includes(" left") || lower.includes(" gauche")) return "left";
    if (lower.includes("[r]") || lower.includes(" right") || lower.includes(" droite")) return "right";
    return null;
}

function preferredHardwareForVirtualJoystick(device: Pick<DeviceInfo, "id" | "kind">, hardwareDevices: HardwareDevice[]) {
    if (device.kind !== "joystick") return null;

    const [, rawInstance = "1"] = device.id.split(":");
    const instance = Math.max(Number(rawInstance) || 1, 1);
    const expectedSide = instance === 1 ? "left" : instance === 2 ? "right" : null;
    if (!expectedSide) return null;

    return hardwareDevices.find((hardware) => {
        if (!isAssignablePhysicalHardware(hardware) || hardware.kind !== "joystick") return false;
        return hardwareSideFromName(hardware.name) === expectedSide;
    }) ?? null;
}

function profileDeviceDisplayName(device: Pick<DeviceInfo, "id" | "name" | "kind">) {
    const baseName = compactProfileDeviceName(device.name || deviceNameFromId(device.id, device.kind));
    if ((device.kind === "joystick" || device.kind === "gamepad") && isVirtualDeviceName(baseName)) {
        const [, instance = "1"] = device.id.split(":");
        return `${baseName} #${instance}`;
    }
    return baseName;
}

function normalizeHardwareName(value: string) {
    return value
        .toLowerCase()
        .replace(/\{[^}]+\}/g, "")
        .replace(/\b(device|controller|controleur|wireless|hid|usb|bluetooth)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function hardwareNamesMatch(profileName: string, hardwareName: string) {
    const profile = normalizeHardwareName(profileName);
    const hardware = normalizeHardwareName(hardwareName);
    if (!profile || !hardware) return false;
    return profile === hardware || profile.includes(hardware) || hardware.includes(profile);
}

function mergeHardwareDevices(devices: HardwareDevice[]) {
    const seen = new Set<string>();
    return devices.filter((device) => {
        const key = `${device.source}:${device.id || device.name}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function hardwareDeviceFingerprint(device: HardwareDevice) {
    return [
        device.source,
        device.id,
        device.name,
        device.kind,
        device.virtualDevice ? "1" : "0",
        device.status ?? "",
        device.buttons ?? 0,
        device.axes ?? 0,
    ].join("\u0001");
}

function hardwareDevicesEqual(first: HardwareDevice[], second: HardwareDevice[]) {
    if (first.length !== second.length) return false;
    const firstFingerprints = first.map(hardwareDeviceFingerprint).sort();
    const secondFingerprints = second.map(hardwareDeviceFingerprint).sort();
    return firstFingerprints.every((fingerprint, index) => fingerprint === secondFingerprints[index]);
}

function keepHardwareDevicesIfUnchanged(current: HardwareDevice[], next: HardwareDevice[]) {
    return hardwareDevicesEqual(current, next) ? current : next;
}

function hardwareForProfileDevice(device: Pick<DeviceInfo, "id" | "name" | "kind"> | null | undefined, hardwareDevices: HardwareDevice[]) {
    if (!device || device.id === "keyboard" || device.id === "mouse" || device.id === NO_DEVICE) return null;
    if (isVirtualDeviceName(device.name)) return null;
    if (isGenericDeviceName(device.name, device.id, device.kind)) return null;

    return hardwareDevices.find((hardware) => {
        if (!isAssignablePhysicalHardware(hardware)) return false;
        return hardwareNamesMatch(device.name, hardware.name);
    }) ?? null;
}

function physicalHardwareForVirtualDevice(device: Pick<DeviceInfo, "id" | "kind">, hardwareDevices: HardwareDevice[]) {
    const preferredHardware = preferredHardwareForVirtualJoystick(device, hardwareDevices);
    if (preferredHardware) return preferredHardware;

    const [, rawInstance = "1"] = device.id.split(":");
    const instance = Math.max(Number(rawInstance) || 1, 1);
    const seen = new Set<string>();
    const candidates = hardwareDevices.filter((hardware) => {
        if (!isAssignablePhysicalHardware(hardware)) return false;
        if (device.kind === "joystick" && hardware.kind !== "joystick") return false;
        if (device.kind === "gamepad" && hardware.kind !== "gamepad") return false;
        if (device.kind !== "joystick" && device.kind !== "gamepad") return false;

        const key = normalizeHardwareName(hardware.name) || hardware.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return candidates[instance - 1] ?? null;
}

function linkedHardwareForVirtualDevice(
    device: Pick<DeviceInfo, "id" | "kind">,
    hardwareDevices: HardwareDevice[],
    hardwareLinks: Record<string, string>
) {
    const linkedHardwareId = hardwareLinks[device.id];
    if (linkedHardwareId && linkedHardwareId !== AUTO_HARDWARE_LINK) {
        return hardwareDevices.find((hardware) => hardware.id === linkedHardwareId && isLinkablePhysicalHardware(hardware)) ?? null;
    }

    return physicalHardwareForVirtualDevice(device, hardwareDevices);
}

function linkedHardwareForProfileDevice(
    device: Pick<DeviceInfo, "id" | "name" | "kind">,
    hardwareDevices: HardwareDevice[],
    hardwareLinks: Record<string, string>
) {
    const linkedHardwareId = hardwareLinks[device.id];
    if (linkedHardwareId && linkedHardwareId !== AUTO_HARDWARE_LINK) {
        return hardwareDevices.find((hardware) => hardware.id === linkedHardwareId && isLinkablePhysicalHardware(hardware)) ?? null;
    }

    return hardwareForProfileDevice(device, hardwareDevices)
        ?? physicalHardwareForVirtualDevice(device, hardwareDevices);
}

function hardwareMatchesCapturedGamepad(
    hardware: HardwareDevice | null | undefined,
    captured: Pick<CapturedGamepadInput, "deviceId" | "deviceName" | "deviceKind">
) {
    if (!hardware) return false;
    // Match exact par ID : si l'user a lie une card via "Lie a" a un device
    // gilrs (ID au format "native:<slot>:<name>") et la capture vient du meme
    // slot, on retourne true direct.
    if (hardware.id === captured.deviceId) return true;
    if (hardware.source === "browser" && hardware.id === captured.deviceId) return true;
    if (hardware.kind !== "unknown" && captured.deviceKind !== "unknown" && hardware.kind !== captured.deviceKind) return false;

    const hardwareSide = hardwareSideFromName(hardware.name);
    const capturedSide = hardwareSideFromName(captured.deviceName);
    if (hardwareSide && capturedSide) return hardwareSide === capturedSide;

    return hardwareNamesMatch(hardware.name, captured.deviceName);
}

function capturedGamepadInputKey(captured: CapturedGamepadInput) {
    return `${captured.deviceId}:${captured.input}`;
}

function gamepadInputSuffix(input: string) {
    return input.replace(/^js\d+_/i, "").replace(/^(?:xi|xinput|gamepad)\d*[_-]/i, "");
}

function inputForProfileDevice(device: Pick<DeviceInfo, "id" | "kind">, capturedInput: string) {
    const [, instance = "1"] = device.id.split(":");
    const suffix = gamepadInputSuffix(capturedInput);
    if (!suffix) return capturedInput;
    if (device.kind === "gamepad") return `gamepad${instance}_${suffix}`;
    return `js${instance}_${suffix}`;
}

function resolveCapturedGamepadInput(
    captured: CapturedGamepadInput,
    profileDevices: DeviceInfo[],
    hardwareDevices: HardwareDevice[],
    hardwareLinks: Record<string, string>,
    editingRow: BindingRow | null,
    selectedDeviceId: string
) {
    const candidates = profileDevices.filter((device) => device.kind === "joystick" || device.kind === "gamepad");
    const linkedDevice = candidates.find((device) => {
        const linkedHardware = linkedHardwareForProfileDevice(device, hardwareDevices, hardwareLinks);
        return hardwareMatchesCapturedGamepad(linkedHardware, captured);
    });
    if (linkedDevice) return inputForProfileDevice(linkedDevice, captured.input);

    const selectedDevice = selectedDeviceId !== ALL_DEVICES && selectedDeviceId !== NO_DEVICE
        ? candidates.find((device) => device.id === selectedDeviceId)
        : null;
    if (selectedDevice) return inputForProfileDevice(selectedDevice, captured.input);

    const rowDevice = editingRow && (editingRow.deviceKind === "joystick" || editingRow.deviceKind === "gamepad")
        ? candidates.find((device) => device.id === editingRow.deviceId) ?? {
            id: editingRow.deviceId,
            name: deviceNameFromId(editingRow.deviceId, editingRow.deviceKind),
            kind: editingRow.deviceKind,
            bindingCount: 0,
        }
        : null;
    if (rowDevice) return inputForProfileDevice(rowDevice, captured.input);

    return captured.input;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
    return new Promise<T>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
        promise
            .then(resolve, reject)
            .finally(() => window.clearTimeout(timeout));
    });
}

function hardwareLinkStorageKey(selectedVersion: string, profilePath: string) {
    return `startrad-bindings-hardware-links:${selectedVersion}:${profilePath}`;
}

function hiddenSlotsStorageKey(selectedVersion: string) {
    return `startrad-bindings-hidden-slots:${selectedVersion}`;
}

function hiddenHwStorageKey(selectedVersion: string) {
    return `startrad-bindings-hidden-hw:${selectedVersion}`;
}

function gilrsSlotMapStorageKey(selectedVersion: string, profilePath: string) {
    return `startrad-bindings-gilrs-map:${selectedVersion}:${profilePath}`;
}

function normalizeInputForDevice(rawInput: string, deviceKind?: DeviceKind) {
    const input = cleanBindingInput(rawInput);
    if (!input) return "";
    if (!deviceKind || deviceKind === "unknown" || deviceKind === "keyboard" || deviceKind === "mouse") return input;

    const lower = input.toLowerCase();
    if (deviceKind === "joystick") {
        return /^js\d+_/.test(lower) ? lower : `js1_${lower}`;
    }
    if (deviceKind === "gamepad") {
        return /^(xi|xinput|gamepad)\d*[_-]/.test(lower) ? lower : `gamepad1_${lower}`;
    }
    return input;
}

function bindingFromInput(rawInput: string, deviceKind?: DeviceKind): BindingInput | null {
    const input = normalizeInputForDevice(rawInput, deviceKind);
    if (!input) return null;
    const inferredKind = inferDeviceKind(input);
    const kind = deviceKind === "keyboard" && inferredKind !== "keyboard"
        ? inferredKind
        : deviceKind && deviceKind !== "unknown"
            ? deviceKind
            : inferredKind;

    return {
        input,
        deviceKind: kind,
        deviceId: inputDeviceId(input),
    };
}

function deviceIcon(kind: DeviceKind) {
    if (kind === "keyboard") return Keyboard;
    if (kind === "mouse") return Mouse;
    return Gamepad2;
}

function formatKeyPart(part: string) {
    const lower = part.toLowerCase();
    if (KEY_NAMES[lower]) return KEY_NAMES[lower];
    if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
    if (lower.length === 1) return lower.toUpperCase();
    return titleCase(lower.replace(/_/g, " "));
}

function formatGamepadPart(part: string) {
    const lower = part.toLowerCase();
    if (GAMEPAD_NAMES[lower]) return GAMEPAD_NAMES[lower];
    const button = lower.match(/^button(\d+)$/);
    if (button) return `Button ${button[1]}`;
    return titleCase(lower.replace(/_/g, " "));
}

function formatBindingInput(value: string) {
    const input = cleanBindingInput(value);
    if (!input) return "Non attribue";

    const lower = input.toLowerCase();
    const keyboardInput = lower.match(/^kb\d+_(.+)$/);
    if (keyboardInput) return formatKeyPart(keyboardInput[1]);

    const joystickButton = lower.match(/^js(\d+)_button(\d+)$/);
    if (joystickButton) return `Joystick ${joystickButton[1]} - Button ${joystickButton[2]}`;

    const joystickAxis = lower.match(/^js(\d+)_(.+)$/);
    if (joystickAxis) {
        const axisName = AXIS_NAMES[joystickAxis[2]] ?? titleCase(joystickAxis[2].replace(/_/g, " "));
        return `Joystick ${joystickAxis[1]} - ${axisName}`;
    }

    const gamepadButton = lower.match(/^(?:xi|xinput|gamepad)(\d*)[_-]button(\d+)$/);
    if (gamepadButton) return `Gamepad ${gamepadButton[1] || "1"} - Button ${gamepadButton[2]}`;

    const gamepadInput = lower.match(/^(?:xi|xinput|gamepad)(\d*)[_-](.+)$/);
    if (gamepadInput) {
        const parts = gamepadInput[2].split("+").map(formatGamepadPart).join(" + ");
        return `Gamepad ${gamepadInput[1] || "1"} - ${parts}`;
    }

    const mouseAxis = lower.match(/^maxis_(.+)$/);
    if (mouseAxis) return `Mouse Axis ${mouseAxis[1].toUpperCase()}`;

    if (lower.includes("+")) {
        return lower.split("+").map(formatKeyPart).join(" + ");
    }

    return formatKeyPart(lower);
}

function isAnalogInput(value: string) {
    const input = cleanBindingInput(value).toLowerCase();
    if (!input) return false;
    if (/^js\d+_(x|y|z|rotx|roty|rotz|slider\d*)$/.test(input)) return true;
    if (/^(xi|xinput|gamepad)\d*[_-](axis|x|y|z|rotx|roty|trigger)/.test(input)) return true;
    return input.includes("axis");
}

function parseXml(xml: string) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
        throw new Error(parserError.textContent?.trim() || "XML invalide.");
    }
    return doc;
}

function rowHasCurveOptions(doc: Document, actionName: string) {
    return Array.from(doc.querySelectorAll("options")).some((options) => {
        return directChildren(options, actionName).some((child) => {
            return child.hasAttribute("exponent") || child.hasAttribute("deadzone") || child.hasAttribute("saturation");
        });
    });
}

function extractActionBindings(actionElement: Element) {
    const bindings: BindingInput[] = [];
    const seen = new Set<string>();
    const addBinding = (rawInput: string | null | undefined, deviceKind?: DeviceKind) => {
        const binding = bindingFromInput(rawInput ?? "", deviceKind);
        if (!binding) return;
        const key = `${binding.deviceId}:${binding.input}`;
        if (seen.has(key)) return;
        seen.add(key);
        bindings.push(binding);
    };

    directChildren(actionElement, "rebind").forEach((rebind) => {
        addBinding(getAttribute(rebind, ["input", "Input"]));
    });

    [
        ["keyboard", "keyboard"],
        ["mouse", "mouse"],
        ["gamepad", "gamepad"],
        ["joystick", "joystick"],
    ].forEach(([attribute, kind]) => {
        addBinding(actionElement.getAttribute(attribute), kind as DeviceKind);
        directChildren(actionElement, attribute).forEach((child) => {
            addBinding(getAttribute(child, ["input", "Input"]), kind as DeviceKind);
        });
    });

    return bindings;
}

function parseBindings(xml: string): ParsedBindings {
    const doc = parseXml(xml);
    const rows: BindingRow[] = [];
    const deviceCounts = new Map<string, DeviceInfo>();
    const actionMaps = Array.from(doc.querySelectorAll("actionmap"));

    actionMaps.forEach((actionMapElement, mapIndex) => {
        const actionMap = actionMapElement.getAttribute("name") || `actionmap_${mapIndex + 1}`;
        directChildren(actionMapElement, "action").forEach((actionElement, actionIndex) => {
            const actionName = actionElement.getAttribute("name") || `action_${actionIndex + 1}`;
            const labelFromXml = getAttribute(actionElement, ["label", "displayName", "displayname", "uiLabel", "UILabel"]);
            const actionLabel = humanizeActionName(actionName, labelFromXml);
            const bindings = extractActionBindings(actionElement);
            const firstBinding = bindings[0];
            const firstInput = firstBinding?.input ?? "";
            const deviceId = firstBinding?.deviceId ?? inputDeviceId(firstInput);
            const deviceKind = firstBinding?.deviceKind ?? inferDeviceKind(firstInput);
            const hasBinding = bindings.some((binding) => hasBindingInput(binding.input));
            const canEditCurve = bindings.some((binding) => isAnalogInput(binding.input)) || rowHasCurveOptions(doc, actionName);

            if (hasBinding) {
                bindings.forEach((binding) => {
                    const current = deviceCounts.get(binding.deviceId) ?? {
                        id: binding.deviceId,
                        name: deviceNameFromId(binding.deviceId, binding.deviceKind),
                        kind: binding.deviceKind,
                        instance: binding.deviceId.includes(":") ? binding.deviceId.split(":")[1] : undefined,
                        bindingCount: 0,
                    };
                    current.bindingCount += 1;
                    deviceCounts.set(binding.deviceId, current);
                });
            }

            rows.push({
                id: `${actionMap}:${actionName}:${actionIndex}`,
                actionName,
                actionLabel,
                actionMap,
                bindings,
                deviceId,
                deviceKind,
                hasBinding,
                canEditCurve,
            });
        });
    });

    Array.from(doc.querySelectorAll("options, device, controller")).forEach((element) => {
        const type = (getAttribute(element, ["type", "name"]) || "").toLowerCase();
        const instance = getAttribute(element, ["instance", "id"]) || "1";
        let kind: DeviceKind = "unknown";

        if (type.includes("keyboard")) kind = "keyboard";
        if (type.includes("mouse")) kind = "mouse";
        if (type.includes("joystick") || type.startsWith("js")) kind = "joystick";
        if (type.includes("gamepad") || type.includes("xinput")) kind = "gamepad";
        if (kind === "unknown") return;

        const id = kind === "keyboard" || kind === "mouse" ? kind : `${kind}:${instance}`;
        const product = getAttribute(element, ["product", "Product", "name"]);
        const existing = deviceCounts.get(id);
        if (existing) {
            if (product && isGenericDeviceName(existing.name, id, kind)) {
                existing.name = product;
            }
            existing.kind = kind;
        } else {
            deviceCounts.set(id, {
                id,
                name: product && !["keyboard", "mouse", "joystick", "gamepad"].includes(product.toLowerCase())
                    ? product
                    : deviceNameFromId(id, kind),
                kind,
                instance,
                bindingCount: 0,
            });
        }
    });

    const devices = Array.from(deviceCounts.values()).sort((a, b) => {
        if (a.id === "keyboard") return -1;
        if (b.id === "keyboard") return 1;
        if (a.id === "mouse") return -1;
        if (b.id === "mouse") return 1;
        return a.name.localeCompare(b.name);
    });

    return {
        rows,
        devices,
        actionMapCount: actionMaps.length,
    };
}

function findActionElement(doc: Document, row: BindingRow) {
    const maps = Array.from(doc.querySelectorAll("actionmap"));
    for (const actionMapElement of maps) {
        if ((actionMapElement.getAttribute("name") || "") !== row.actionMap) continue;
        const action = directChildren(actionMapElement, "action").find(
            (child) => child.getAttribute("name") === row.actionName
        );
        if (action) return action;
    }
    return null;
}

function serializeDoc(doc: Document) {
    return new XMLSerializer().serializeToString(doc);
}

// Nettoie les declarations `<options type="joystick" instance="N" Product="vJoy Device...">`
// que MES versions precedentes ajoutaient automatiquement au save. L'utilisateur
// n'en veut pas dans startrad_user ; SC se debrouille tout seul pour mapper
// js<N> via l'ordre des devices.
const AUTO_ADDED_VJOY_GUID = "{BEAD1234-0000-0000-0000-504944564944}";

function stripAutoAddedVjoyDeclarations(xml: string): string {
    const doc = parseXml(xml);
    let removed = false;
    Array.from(doc.querySelectorAll("options")).forEach((options) => {
        const type = (options.getAttribute("type") || "").toLowerCase();
        const product = options.getAttribute("Product") || "";
        // On ne retire que les vJoy auto-ajoutees par notre code (GUID specifique
        // ET pas de contenu enfant, donc c'est juste une declaration vide).
        if (type === "joystick" && product.includes(AUTO_ADDED_VJOY_GUID) && options.children.length === 0) {
            options.remove();
            removed = true;
        }
    });
    return removed ? serializeDoc(doc) : xml;
}

function updateActionBinding(xml: string, row: BindingRow, nextInput: string) {
    const doc = parseXml(xml);
    const action = findActionElement(doc, row);
    if (!action) throw new Error("Action introuvable dans le XML.");

    directChildren(action, "rebind").forEach((rebind) => rebind.remove());
    ["keyboard", "mouse", "gamepad", "joystick"].forEach((deviceKey) => {
        action.removeAttribute(deviceKey);
        directChildren(action, deviceKey).forEach((child) => child.remove());
    });
    const cleaned = cleanBindingInput(nextInput);
    if (cleaned) {
        const rebind = doc.createElement("rebind");
        rebind.setAttribute("input", cleaned);
        action.appendChild(rebind);
    }

    return serializeDoc(doc);
}

function findOrCreateOptions(doc: Document, row: BindingRow) {
    const root = doc.documentElement;
    const kind = row.deviceKind === "unknown" ? "joystick" : row.deviceKind;
    const instance = row.deviceId.includes(":") ? row.deviceId.split(":")[1] : "1";
    const existing = Array.from(doc.querySelectorAll("options")).find((options) => {
        const type = (options.getAttribute("type") || "").toLowerCase();
        const optionInstance = options.getAttribute("instance") || "1";
        return type === kind && optionInstance === instance;
    });

    if (existing) return existing;

    const options = doc.createElement("options");
    options.setAttribute("type", kind);
    options.setAttribute("instance", instance);
    root.appendChild(options);
    return options;
}

function findOrCreateDeviceOption(doc: Document, input: string) {
    const root = doc.documentElement;
    const device = input.match(/^(js\d+|xi\d*|xinput\d*|gamepad\d*)_/i)?.[1] ?? "js1";
    let deviceOptions = Array.from(doc.querySelectorAll("deviceoptions")).find((element) => {
        const name = element.getAttribute("name") || element.getAttribute("device");
        return (name || "").toLowerCase() === device.toLowerCase();
    });

    if (!deviceOptions) {
        deviceOptions = doc.createElement("deviceoptions");
        deviceOptions.setAttribute("name", device);
        root.appendChild(deviceOptions);
    }

    let option = directChildren(deviceOptions, "option").find((element) => {
        return cleanBindingInput(element.getAttribute("input")).toLowerCase() === input.toLowerCase();
    });

    if (!option) {
        option = doc.createElement("option");
        option.setAttribute("input", input);
        deviceOptions.appendChild(option);
    }

    return option;
}

function readCurveSettings(xml: string, row: BindingRow): CurveDraft {
    const doc = parseXml(xml);
    const firstInput = row.bindings.find((binding) => hasBindingInput(binding.input))?.input ?? "";
    const actionOption = Array.from(doc.querySelectorAll("options"))
        .flatMap((options) => directChildren(options, row.actionName))
        .find(Boolean);
    const deviceOption = firstInput
        ? Array.from(doc.querySelectorAll("deviceoptions option")).find((option) => {
            return cleanBindingInput(option.getAttribute("input")).toLowerCase() === firstInput.toLowerCase();
        })
        : null;

    return {
        exponent: Number(actionOption?.getAttribute("exponent") ?? 1) || 1,
        deadzone: Number(deviceOption?.getAttribute("deadzone") ?? 0) || 0,
        saturation: Number(deviceOption?.getAttribute("saturation") ?? 1) || 1,
    };
}

function updateCurveSettings(xml: string, row: BindingRow, draft: CurveDraft) {
    const doc = parseXml(xml);
    const firstInput = row.bindings.find((binding) => hasBindingInput(binding.input))?.input ?? "";

    const options = findOrCreateOptions(doc, row);
    let actionOption = directChildren(options, row.actionName)[0];
    if (!actionOption) {
        actionOption = doc.createElement(row.actionName);
        options.appendChild(actionOption);
    }
    actionOption.setAttribute("exponent", draft.exponent.toFixed(2));

    if (firstInput) {
        const deviceOption = findOrCreateDeviceOption(doc, firstInput);
        deviceOption.setAttribute("deadzone", draft.deadzone.toFixed(2));
        deviceOption.setAttribute("saturation", draft.saturation.toFixed(2));
    }

    return serializeDoc(doc);
}

function keyboardEventToInput(event: KeyboardEvent) {
    const modifier = (code: string, left: string, right: string) => code.endsWith("Right") ? right : left;
    const parts: string[] = [];
    const key = event.key;
    const code = event.code;

    if (event.ctrlKey && key !== "Control") parts.push(code === "ControlRight" ? "rctrl" : "lctrl");
    if (event.altKey && key !== "Alt") parts.push(code === "AltRight" ? "ralt" : "lalt");
    if (event.shiftKey && key !== "Shift") parts.push(code === "ShiftRight" ? "rshift" : "lshift");

    if (key === "Control") parts.push(modifier(code, "lctrl", "rctrl"));
    else if (key === "Alt") parts.push(modifier(code, "lalt", "ralt"));
    else if (key === "Shift") parts.push(modifier(code, "lshift", "rshift"));
    else if (key === " ") parts.push("space");
    else if (key === "Escape") parts.push("escape");
    else if (key === "ArrowUp") parts.push("up");
    else if (key === "ArrowDown") parts.push("down");
    else if (key === "ArrowLeft") parts.push("left");
    else if (key === "ArrowRight") parts.push("right");
    else if (key.length === 1) parts.push(key.toLowerCase());
    else parts.push(key.toLowerCase());

    return Array.from(new Set(parts)).join("+");
}

function curvePath(draft: CurveDraft) {
    const points: string[] = [];
    const deadzone = Math.min(Math.max(draft.deadzone, 0), 0.95);
    const saturation = Math.min(Math.max(draft.saturation, 0), 1);
    const exponent = Math.max(draft.exponent, 0.1);

    for (let index = 0; index <= 100; index += 2) {
        const x = index / 100;
        const adjusted = x <= deadzone ? 0 : (x - deadzone) / (1 - deadzone);
        const y = Math.min(Math.pow(adjusted, exponent) * saturation, 1);
        points.push(`${x * 100},${100 - y * 100}`);
    }

    return points.join(" ");
}

function formatNumber(value: number) {
    return value.toFixed(2);
}

function inferHardwareKindFromName(name: string): DeviceKind {
    const lower = name.toLowerCase();
    if (lower.includes("xbox")
        || lower.includes("dualsense")
        || lower.includes("wireless controller")
        || lower.includes("gamepad")
        || lower.includes("manette")) {
        return "gamepad";
    }
    return "joystick";
}

function readBrowserHardwareDevices(): HardwareDevice[] {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) return [];

    return Array.from(gamepads)
        .filter((gamepad): gamepad is Gamepad => Boolean(gamepad?.connected))
        .map((gamepad) => ({
            id: `browser:${gamepad.index}:${gamepad.id}`,
            slot: gamepad.index + 1,
            name: compactHardwareName(gamepad.id || `Joystick ${gamepad.index + 1}`),
            kind: inferHardwareKindFromName(gamepad.id),
            source: "browser",
            virtualDevice: isVirtualDeviceName(gamepad.id),
            buttons: gamepad.buttons.length,
            axes: gamepad.axes.length,
        }));
}

const GAMEPAD_BUTTON_THRESHOLD = 0.6;
const GAMEPAD_AXIS_THRESHOLD = 0.65;

function readActiveGamepadInputs(): CapturedGamepadInput[] {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) return [];

    const inputs: CapturedGamepadInput[] = [];
    for (const gamepad of Array.from(gamepads)) {
        if (!gamepad?.connected) continue;

        const slot = gamepad.index + 1;
        const deviceName = compactHardwareName(gamepad.id || `Joystick ${slot}`);
        const deviceKind = inferHardwareKindFromName(deviceName);
        const deviceId = `browser:${gamepad.index}:${gamepad.id}`;
        gamepad.buttons.forEach((button, index) => {
            if (button.pressed || button.value > GAMEPAD_BUTTON_THRESHOLD) {
                inputs.push({
                    input: `js${slot}_button${index + 1}`,
                    deviceId,
                    deviceName,
                    deviceKind,
                });
            }
        });
        gamepad.axes.forEach((axis, index) => {
            if (Math.abs(axis) > GAMEPAD_AXIS_THRESHOLD) {
                const axisName = ["x", "y", "z", "rotx", "roty", "rotz"][index] ?? `axis${index}`;
                inputs.push({
                    input: `js${slot}_${axisName}`,
                    deviceId,
                    deviceName,
                    deviceKind,
                });
            }
        });
    }

    return inputs;
}

interface BindingsEditorProps {
    selectedVersion: string;
}

export function BindingsEditor({ selectedVersion }: BindingsEditorProps) {
    const { toast } = useToast();
    const [profiles, setProfiles] = useState<BindingFile[]>([]);
    const [selectedProfilePath, setSelectedProfilePath] = useState("");
    const [xmlContent, setXmlContent] = useState("");
    const [originalXml, setOriginalXml] = useState("");
    const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
    const [isLoadingXml, setIsLoadingXml] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshingHardware, setIsRefreshingHardware] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedDeviceId, setSelectedDeviceId] = useState(ALL_DEVICES);
    const [showEmptyActions, setShowEmptyActions] = useState(true);
    const [baseError, setBaseError] = useState("");
    const [editingRow, setEditingRow] = useState<BindingRow | null>(null);
    const [editValue, setEditValue] = useState("");
    // Garde les rows récemment éditées visibles même si le filtre actuel ne match plus,
    // pour ne pas faire "disparaître" l'action que l'user vient de modifier.
    const [stickyRowIds, setStickyRowIds] = useState<Set<string>>(() => new Set());
    const [curveRow, setCurveRow] = useState<BindingRow | null>(null);
    const [curveDraft, setCurveDraft] = useState<CurveDraft>({ exponent: 1, deadzone: 0, saturation: 1 });
    const [hardwareDevices, setHardwareDevices] = useState<HardwareDevice[]>([]);
    const [hardwareLinks, setHardwareLinks] = useState<Record<string, string>>({});
    // Slots masques (oeil sur la carte). Stocke device.id, pas hardware.id :
    // cliquer l'oeil sur "Joystick 1" cache "Joystick 1", pas le hw lie.
    // Persiste par version pour que le choix tienne entre sessions.
    const [hiddenSlotIds, setHiddenSlotIds] = useState<Set<string>>(() => new Set());
    // IDs hardware Windows masques par l'user (via l'oeil). Masquer un hw
    // = il disparait des cards ET la numerotation se resserre. Du coup si tu
    // masques MOZA / Keychron entre Sol-R [L] et Sol-R [R], Sol-R [R]
    // devient joystick:2 au lieu de joystick:5.
    const [hiddenHwIds, setHiddenHwIds] = useState<Set<string>>(() => new Set());
    // Mapping dynamique gilrs_slot -> cardId (joystick:N) appris au premier
    // press. Modele SC : "le premier stick que tu presses devient js1, le
    // deuxieme js2, etc.". Persiste par profil pour que ton choix tienne
    // entre sessions.
    const [gilrsSlotMap, setGilrsSlotMap] = useState<Record<number, string>>({});
    const hardwareRefreshInFlight = useRef(false);
    const componentMountedRef = useRef(true);
    // Ref vers la liste de cards a jour (devices augmentes avec les slots
    // auto-crees pour les sticks physiques). Utilisee par la dialog d'edition
    // pour resoudre la capture d'input vers le bon joystick:N (ex: Sol-R [R]
    // capture js6_button35 cote gilrs mais doit etre remappe en js2_button35
    // si la card de Sol-R [R] est joystick:2). Updatee dans une useEffect plus
    // bas une fois devices calcule.
    const devicesRef = useRef<DeviceInfo[]>([]);
    // Ref pour le mapping gilrs slot -> cardId, accessible depuis le polling.
    const gilrsSlotMapRef = useRef<Record<number, string>>({});

    const selectedProfile = useMemo(
        () => profiles.find((profile) => profile.path === selectedProfilePath) ?? null,
        [profiles, selectedProfilePath]
    );
    const selectedProfileIsBase = isBaseProfile(selectedProfile);

    const isDirty = xmlContent !== originalXml;

    const parsedResult = useMemo(() => {
        if (!xmlContent.trim()) return { parsed: null as ParsedBindings | null, error: "" };
        try {
            return { parsed: parseBindings(xmlContent), error: "" };
        } catch (error) {
            return { parsed: null as ParsedBindings | null, error: toErrorMessage(error, "Impossible de lire le XML.") };
        }
    }, [xmlContent]);

    const parsed = parsedResult.parsed;

    const loadProfiles = useCallback(async (preferredPath?: string) => {
        if (!selectedVersion) return;
        setIsLoadingProfiles(true);
        setBaseError("");
        const preferredProfilePath = typeof preferredPath === "string" ? preferredPath : "";

        try {
            try {
                await invoke<BindingFile>("extract_default_bindings_from_game_data", { version: selectedVersion });
            } catch (error) {
                setBaseError(toErrorMessage(error, "Base Data.pak introuvable."));
            }

            const files = await invoke<BindingFile[]>("list_control_profiles", { version: selectedVersion });
            const sorted = [...files].sort((a, b) => {
                const aRank = isBaseProfile(a) ? 0 : isGeneratedProfile(a, selectedVersion) ? 1 : 2;
                const bRank = isBaseProfile(b) ? 0 : isGeneratedProfile(b, selectedVersion) ? 1 : 2;
                return aRank - bRank || a.name.localeCompare(b.name);
            });

            setProfiles(sorted);
            setSelectedProfilePath((current) => {
                const storedPath = readStoredProfilePath(selectedVersion);
                const currentProfile = sorted.find((profile) => profile.path === current);
                const storedProfile = sorted.find((profile) => profile.path === storedPath);
                const generatedProfile = sorted.find((profile) => isGeneratedProfile(profile, selectedVersion));
                const baseProfile = sorted.find((profile) => isBaseProfile(profile));
                const candidates = [
                    preferredProfilePath,
                    currentProfile && !isBaseProfile(currentProfile) ? current : "",
                    generatedProfile?.path ?? "",
                    storedProfile && isGeneratedProfile(storedProfile, selectedVersion) ? storedPath : "",
                    baseProfile?.path ?? "",
                    sorted[0]?.path ?? "",
                ];
                return candidates.find((path) => path && sorted.some((profile) => profile.path === path)) ?? "";
            });
        } catch (error) {
            toast({
                title: "Bindings",
                description: toErrorMessage(error, "Impossible de charger les profils."),
                variant: "destructive",
            });
        } finally {
            setIsLoadingProfiles(false);
        }
    }, [selectedVersion, toast]);

    const loadProfileXml = useCallback(async (path: string) => {
        if (!path) {
            setXmlContent("");
            setOriginalXml("");
            return;
        }

        setIsLoadingXml(true);
        try {
            const content = await invoke<string>("read_text_file", { path });
            setXmlContent(content);
            setOriginalXml(content);
            setSelectedDeviceId(ALL_DEVICES);
            setSearch("");
        } catch (error) {
            toast({
                title: "Profil",
                description: toErrorMessage(error, "Impossible de lire le profil."),
                variant: "destructive",
            });
        } finally {
            setIsLoadingXml(false);
        }
    }, [toast]);

    const refreshHardwareDevices = useCallback(async () => {
        if (hardwareRefreshInFlight.current) return;
        hardwareRefreshInFlight.current = true;
        setIsRefreshingHardware(true);

        const browserDevices = readBrowserHardwareDevices();
        setHardwareDevices((current) => {
            const next = mergeHardwareDevices([
                ...current.filter((device) => device.source !== "browser"),
                ...browserDevices,
            ]);
            return keepHardwareDevicesIfUnchanged(current, next);
        });

        try {
            const windowsDevices = await withTimeout(
                invoke<HardwareDevice[]>("list_input_hardware_devices"),
                8000,
                "Detection hardware trop longue"
            );
            if (!componentMountedRef.current) return;
            setHardwareDevices((current) => {
                const next = mergeHardwareDevices([
                    ...windowsDevices.map((device) => ({
                        ...device,
                        source: "windows" as const,
                        kind: device.kind || inferHardwareKindFromName(device.name),
                        buttons: device.buttons ?? 0,
                        axes: device.axes ?? 0,
                    })),
                    ...current.filter((device) => device.source === "browser"),
                ]);
                return keepHardwareDevicesIfUnchanged(current, next);
            });
        } catch (error) {
            toast({
                title: "Peripheriques",
                description: toErrorMessage(error, "Impossible de rafraichir les peripheriques."),
                variant: "destructive",
            });
            // La Gamepad API reste disponible si l'inventaire Windows echoue.
        }

        // NB: on n'ajoute PAS les entries gilrs comme hardware (elles ont des
        // noms generiques "Controleur de jeu HID" qui polluent le dropdown
        // "Lie a"). L'auto-mapping cote resolver utilise directement le slot
        // gilrs depuis captured.input pour traduire en js<N>, donc on n'a
        // pas besoin d'exposer les entries gilrs au niveau hardware.

        hardwareRefreshInFlight.current = false;
        if (componentMountedRef.current) {
            setIsRefreshingHardware(false);
        }
    }, [toast]);

    useEffect(() => {
        componentMountedRef.current = true;
        return () => {
            componentMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        loadProfiles();
    }, [loadProfiles]);

    useEffect(() => {
        loadProfileXml(selectedProfilePath);
        if (selectedProfilePath) {
            rememberSelectedProfilePath(selectedVersion, selectedProfilePath);
        }
    }, [selectedProfilePath, loadProfileXml]);

    const hardwareLinksLoadedKey = useRef<string | null>(null);
    const hardwareLinksSkipNextSave = useRef(false);
    useEffect(() => {
        if (!selectedProfilePath) {
            setHardwareLinks({});
            hardwareLinksLoadedKey.current = null;
            return;
        }

        try {
            const stored = localStorage.getItem(hardwareLinkStorageKey(selectedVersion, selectedProfilePath));
            setHardwareLinks(stored ? JSON.parse(stored) : {});
        } catch {
            setHardwareLinks({});
        }
        hardwareLinksLoadedKey.current = `${selectedVersion}|${selectedProfilePath}`;
        hardwareLinksSkipNextSave.current = true;
    }, [selectedProfilePath, selectedVersion]);

    useEffect(() => {
        if (!selectedProfilePath) return;
        if (hardwareLinksLoadedKey.current !== `${selectedVersion}|${selectedProfilePath}`) return;
        if (hardwareLinksSkipNextSave.current) {
            hardwareLinksSkipNextSave.current = false;
            return;
        }
        localStorage.setItem(hardwareLinkStorageKey(selectedVersion, selectedProfilePath), JSON.stringify(hardwareLinks));
    }, [hardwareLinks, selectedProfilePath, selectedVersion]);

    // Persistance du mapping gilrs slot -> cardId (par profil).
    const gilrsMapLoadedKey = useRef<string | null>(null);
    const gilrsMapSkipNextSave = useRef(false);
    useEffect(() => {
        if (!selectedProfilePath) {
            setGilrsSlotMap({});
            gilrsMapLoadedKey.current = null;
            return;
        }
        try {
            const raw = localStorage.getItem(gilrsSlotMapStorageKey(selectedVersion, selectedProfilePath));
            setGilrsSlotMap(raw ? JSON.parse(raw) : {});
        } catch {
            setGilrsSlotMap({});
        }
        gilrsMapLoadedKey.current = `${selectedVersion}|${selectedProfilePath}`;
        gilrsMapSkipNextSave.current = true;
    }, [selectedProfilePath, selectedVersion]);

    useEffect(() => {
        if (!selectedProfilePath) return;
        if (gilrsMapLoadedKey.current !== `${selectedVersion}|${selectedProfilePath}`) return;
        if (gilrsMapSkipNextSave.current) {
            gilrsMapSkipNextSave.current = false;
            return;
        }
        localStorage.setItem(gilrsSlotMapStorageKey(selectedVersion, selectedProfilePath), JSON.stringify(gilrsSlotMap));
    }, [gilrsSlotMap, selectedProfilePath, selectedVersion]);

    // Charge les sets masques au mount / changement de version (sans
    // declencher de save - les saves se font inline via setHiddenSlotIdsAndSave).
    useEffect(() => {
        try {
            const raw = localStorage.getItem(hiddenSlotsStorageKey(selectedVersion));
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    setHiddenSlotIds(new Set(parsed.filter((x): x is string => typeof x === "string")));
                    return;
                }
            }
        } catch {}
        setHiddenSlotIds(new Set());
    }, [selectedVersion]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(hiddenHwStorageKey(selectedVersion));
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    setHiddenHwIds(new Set(parsed.filter((x): x is string => typeof x === "string")));
                    return;
                }
            }
        } catch {}
        setHiddenHwIds(new Set());
    }, [selectedVersion]);

    // Setters wrappes qui sauvegardent SYNCHRONEMENT dans localStorage.
    // Pas de useEffect-save = pas de race possible avec le load.
    const setHiddenSlotIdsAndSave = useCallback((updater: (prev: Set<string>) => Set<string>) => {
        setHiddenSlotIds((prev) => {
            const next = updater(prev);
            try {
                localStorage.setItem(hiddenSlotsStorageKey(selectedVersion), JSON.stringify(Array.from(next)));
            } catch {}
            return next;
        });
    }, [selectedVersion]);

    const setHiddenHwIdsAndSave = useCallback((updater: (prev: Set<string>) => Set<string>) => {
        setHiddenHwIds((prev) => {
            const next = updater(prev);
            try {
                localStorage.setItem(hiddenHwStorageKey(selectedVersion), JSON.stringify(Array.from(next)));
            } catch {}
            return next;
        });
    }, [selectedVersion]);

    useEffect(() => {
        void refreshHardwareDevices();
    }, [refreshHardwareDevices]);

    useEffect(() => {
        if (!editingRow) return;
        const ignoredGamepadInputs = new Set(readActiveGamepadInputs().map(capturedGamepadInputKey));
        const warmupUntil = Date.now() + 300;
        const setCapturedValue = (value: string) => {
            setEditValue((current) => {
                return current === value ? current : value;
            });
        };

        const onKeyDown = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            setCapturedValue(keyboardEventToInput(event));
        };
        const onMouseDown = (event: MouseEvent) => {
            if (event.button > 4) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("button, input, textarea, select, [role='button']")) return;
            event.preventDefault();
            setCapturedValue(`mouse${event.button + 1}`);
        };
        const onWheel = (event: WheelEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("button, input, textarea, select, [role='button']")) return;
            event.preventDefault();
            setCapturedValue(event.deltaY < 0 ? "mwheel_up" : "mwheel_down");
        };

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("mousedown", onMouseDown, true);
        window.addEventListener("wheel", onWheel, { capture: true, passive: false });

        // Cache des inputs natifs (gilrs DirectInput) entre 2 invocations.
        // Le browser API ne voit que XInput, donc on complete avec gilrs pour
        // les vJoy / HOTAS / sticks DirectInput. L'invoke est async, on garde
        // le dernier snapshot pour ne pas bloquer le polling.
        let nativeInputs: CapturedGamepadInput[] = [];
        let nativeInflight = false;
        const debugEnabled = localStorage.getItem("startrad-bindings-debug") === "1";
        const refreshNativeInputs = () => {
            if (nativeInflight) return;
            nativeInflight = true;
            invoke<{ input: string; deviceName: string; slot: number }[]>("read_active_joystick_inputs")
                .then((entries) => {
                    if (debugEnabled && entries.length > 0) {
                        console.log("[bindings:native]", entries);
                    }
                    nativeInputs = entries.map((entry) => ({
                        input: entry.input,
                        deviceId: `native:${entry.slot}:${entry.deviceName}`,
                        deviceName: entry.deviceName,
                        deviceKind: inferHardwareKindFromName(entry.deviceName),
                    }));
                })
                .catch(() => {
                    nativeInputs = [];
                })
                .finally(() => {
                    nativeInflight = false;
                });
        };

        const interval = window.setInterval(() => {
            refreshNativeInputs();
            const browserInputs = readActiveGamepadInputs();
            // Dedup par cle (input + deviceId) : si un meme stick est vu par
            // les deux APIs, on garde une seule entree.
            const merged: CapturedGamepadInput[] = [];
            const seen = new Set<string>();
            for (const input of [...browserInputs, ...nativeInputs]) {
                const key = capturedGamepadInputKey(input);
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(input);
            }
            const activeSet = new Set(merged.map(capturedGamepadInputKey));

            if (Date.now() < warmupUntil) {
                merged.forEach((input) => ignoredGamepadInputs.add(capturedGamepadInputKey(input)));
                return;
            }

            Array.from(ignoredGamepadInputs).forEach((input) => {
                if (!activeSet.has(input)) {
                    ignoredGamepadInputs.delete(input);
                }
            });

            const nextInput = merged.find((input) => !ignoredGamepadInputs.has(capturedGamepadInputKey(input)));
            if (nextInput) {
                // Auto-assignment dynamique du gilrs slot vers un card joystick.
                // Modele SC : "premier stick presse devient js1, deuxieme js2".
                // Si le slot gilrs n'est pas encore mappe, on l'associe au
                // premier card joystick libre (pas encore associe a un autre
                // slot gilrs). Persiste via gilrsSlotMap.
                let resolved = resolveCapturedGamepadInput(
                    nextInput,
                    devicesRef.current,
                    hardwareDevices,
                    hardwareLinks,
                    editingRow,
                    selectedDeviceId,
                );
                const slotMatch = nextInput.input.match(/^js(\d+)_/);
                if (slotMatch && nextInput.deviceId.startsWith("native:")) {
                    const gilrsSlot = Number(slotMatch[1]);
                    const suffix = nextInput.input.replace(/^js\d+_/, "");
                    const currentMap = gilrsSlotMapRef.current;
                    let cardId = currentMap[gilrsSlot];
                    if (!cardId) {
                        // Pas de mapping : trouve le premier card joystick libre
                        // (pas deja associe a un autre slot gilrs).
                        const joystickCards = devicesRef.current.filter((d) => d.kind === "joystick");
                        const usedCardIds = new Set(Object.values(currentMap));
                        const freeCard = joystickCards.find((c) => !usedCardIds.has(c.id));
                        if (freeCard) {
                            cardId = freeCard.id;
                            const newMap = { ...currentMap, [gilrsSlot]: cardId };
                            gilrsSlotMapRef.current = newMap;
                            setGilrsSlotMap(newMap);
                        }
                    }
                    if (cardId) {
                        const instance = cardId.split(":")[1] || "1";
                        resolved = `js${instance}_${suffix}`;
                    }
                }
                if (debugEnabled) {
                    console.log("[bindings:capture] input=", nextInput, " resolved=", resolved, " gilrsMap=", gilrsSlotMapRef.current);
                }
                setCapturedValue(resolved);
                ignoredGamepadInputs.add(capturedGamepadInputKey(nextInput));
            }
        }, 120);

        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("mousedown", onMouseDown, true);
            window.removeEventListener("wheel", onWheel, true);
            window.clearInterval(interval);
        };
    }, [editingRow, hardwareDevices, hardwareLinks, parsed?.devices, selectedDeviceId]);

    useEffect(() => {
        if (localStorage.getItem("startrad-bindings-debug") === "1") {
            console.debug("[bindings] hardware devices", hardwareDevices);
        }
    }, [hardwareDevices]);

    const rows = parsed?.rows ?? [];
    const parsedDevices = parsed?.devices ?? [];
    // linkableHardwareDevices = hw physiques utilisables ET non masques par
    // l'user. Auto-creation se base sur cette liste -> masquer un hw resserre
    // la numerotation joystick:N. Dedup par nom+kind normalise pour eviter
    // les doublons quand PowerShell renvoie 2 entries pour le meme stick
    // (ex: enumeration USB + HID interface du meme Sol-R).
    const deduppedByNameKind = (list: HardwareDevice[]) => {
        const seen = new Map<string, HardwareDevice>();
        for (const h of list) {
            const key = `${h.kind}:${normalizeHardwareName(h.name) || h.id.toLowerCase()}`;
            const existing = seen.get(key);
            // Priorite a "windows" sur "browser" car PnP a typiquement le VID/PID complet.
            if (!existing) {
                seen.set(key, h);
            } else if (existing.source !== "windows" && h.source === "windows") {
                seen.set(key, h);
            }
        }
        return Array.from(seen.values());
    };
    const linkableHardwareDevices = useMemo(
        () => deduppedByNameKind(hardwareDevices.filter((h) => isLinkablePhysicalHardware(h) && !hiddenHwIds.has(h.id))),
        [hardwareDevices, hiddenHwIds]
    );
    // Liste complete (incluant masques) pour rendre les cards fantomes
    // "masque" dans le panneau.
    const allLinkableHardware = useMemo(
        () => deduppedByNameKind(hardwareDevices.filter(isLinkablePhysicalHardware)),
        [hardwareDevices]
    );

    // Cards = keyboard + mouse + vJoy declarations du profil + 1 card par
    // joystick/gamepad physique branche. Les ref generiques type "Joystick 6"
    // venant des bindings du XML (sans correspondance hardware) sont ignorees :
    // si l'utilisateur a 2 sticks physiques, on cree joystick:1 + joystick:2,
    // pas joystick:6. Les bindings js6_* restent visibles dans les actions
    // jusqu'a ce que l'user re-bind sur joystick:2.
    const devicesWithLinks = useMemo(() => {
        const result: DeviceInfo[] = [];
        // Map slot.id -> hw.id (pour traduire un click oeil sur une card
        // auto-creee en mask du hw correspondant).
        const slotToHw = new Map<string, string>();

        // Detection : startrad_user_bindings_* est le fichier de travail
        // genere par notre app. Les vJoy y ont ete auto-ajoutes par MES
        // anciennes versions (corrige depuis). On les ignore TOUJOURS pour
        // le display, peu importe le bindingCount. Pour les profils
        // importes (layout_*_exported), les vJoy sont les vraies cibles SC
        // mises par l'utilisateur lui-meme, donc on les montre.
        const profileFileName = selectedProfilePath.split(/[\\/]/).pop() || "";
        const isStartradUserProfile = profileFileName.startsWith("startrad_user_bindings_");

        // Phase 1 : keyboard, mouse + vJoys (sauf si c'est startrad_user).
        for (const d of parsedDevices) {
            if (d.kind === "keyboard" || d.kind === "mouse") {
                result.push(d);
            } else if (isVirtualDeviceName(d.name) && !isStartradUserProfile) {
                result.push(d);
            }
        }

        const hasVjoyDeclarations = result.some(
            (d) => (d.kind === "joystick" || d.kind === "gamepad") && isVirtualDeviceName(d.name)
        );

        // Phase 2 : 1 card par joystick physique NON masque. linkableHardwareDevices
        // exclut deja les hw masques, donc la numerotation se resserre tout seul.
        const usedJoystickInstances = new Set<number>(
            result.filter((d) => d.kind === "joystick").map((d) => Number(d.instance || "1"))
        );
        // Pour auto-create on prend UNIQUEMENT les entrees windows (Get-PnpDevice).
        // Les entrees gilrs (id "native:...") restent dispo dans le dropdown
        // "Lie a" pour que l'utilisateur puisse les associer manuellement a
        // une card si le matching automatique echoue.
        // ATTENTION : si le XML declare des vJoys, on n'auto-cree PAS de
        // cards physiques (les vJoys sont les cibles de bindings, Gremlin
        // route les sticks vers eux).
        const joystickHardware = hasVjoyDeclarations
            ? []
            : linkableHardwareDevices.filter((h) => h.kind === "joystick" && !h.id.startsWith("native:"));
        const claimedHwIds = new Set<string>();
        const slotsToCreate: { slot: number; hw: HardwareDevice }[] = [];
        let nextSlot = 1;
        for (let i = 0; i < joystickHardware.length; i++) {
            while (usedJoystickInstances.has(nextSlot)) nextSlot++;
            const slotId = `joystick:${nextSlot}`;
            const explicit = hardwareLinks[slotId];
            let chosenHw: HardwareDevice | undefined;
            if (explicit && explicit !== AUTO_HARDWARE_LINK) {
                chosenHw = joystickHardware.find((h) => h.id === explicit && !claimedHwIds.has(h.id));
            }
            if (!chosenHw) {
                chosenHw = joystickHardware.find((h) => !claimedHwIds.has(h.id));
            }
            if (!chosenHw) break;
            claimedHwIds.add(chosenHw.id);
            slotsToCreate.push({ slot: nextSlot, hw: chosenHw });
            usedJoystickInstances.add(nextSlot);
            nextSlot++;
        }
        for (const { slot, hw } of slotsToCreate) {
            const slotId = `joystick:${slot}`;
            result.push({
                id: slotId,
                name: hw.name,
                kind: "joystick",
                instance: String(slot),
                bindingCount: 0,
            });
            slotToHw.set(slotId, hw.id);
        }

        // Phase 3 : 1 card par gamepad physique non masque (exclu gilrs).
        const usedGamepadInstances = new Set<number>(
            result.filter((d) => d.kind === "gamepad").map((d) => Number(d.instance || "1"))
        );
        // Idem pour gamepad : si XML a des vJoys (joystick) on n'auto-cree
        // pas non plus de gamepad. C'est l'interpretation "vJoy => bindings
        // ciblent vJoy, pas physique".
        const gamepadHardware = hasVjoyDeclarations
            ? []
            : linkableHardwareDevices.filter((h) => h.kind === "gamepad" && !h.id.startsWith("native:"));
        const claimedGamepadHwIds = new Set<string>();
        const gamepadSlotsToCreate: { slot: number; hw: HardwareDevice }[] = [];
        let nextGamepadSlot = 1;
        for (let i = 0; i < gamepadHardware.length; i++) {
            while (usedGamepadInstances.has(nextGamepadSlot)) nextGamepadSlot++;
            const slotId = `gamepad:${nextGamepadSlot}`;
            const explicit = hardwareLinks[slotId];
            let chosenHw: HardwareDevice | undefined;
            if (explicit && explicit !== AUTO_HARDWARE_LINK) {
                chosenHw = gamepadHardware.find((h) => h.id === explicit && !claimedGamepadHwIds.has(h.id));
            }
            if (!chosenHw) {
                chosenHw = gamepadHardware.find((h) => !claimedGamepadHwIds.has(h.id));
            }
            if (!chosenHw) break;
            claimedGamepadHwIds.add(chosenHw.id);
            gamepadSlotsToCreate.push({ slot: nextGamepadSlot, hw: chosenHw });
            usedGamepadInstances.add(nextGamepadSlot);
            nextGamepadSlot++;
        }
        for (const { slot, hw } of gamepadSlotsToCreate) {
            const slotId = `gamepad:${slot}`;
            result.push({
                id: slotId,
                name: hw.name,
                kind: "gamepad",
                instance: String(slot),
                bindingCount: 0,
            });
            slotToHw.set(slotId, hw.id);
        }

        return { devices: result, slotToHw };
    }, [parsedDevices, linkableHardwareDevices, hardwareLinks, selectedProfilePath]);
    const devices = devicesWithLinks.devices;
    const slotToHw = devicesWithLinks.slotToHw;
    const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);

    // Sync devicesRef pour la dialog d'edition (qui lit devices via ref pour
    // eviter le TDZ — l'useEffect d'edition est declare avant `devices`).
    useEffect(() => {
        devicesRef.current = devices;
    }, [devices]);
    useEffect(() => {
        gilrsSlotMapRef.current = gilrsSlotMap;
    }, [gilrsSlotMap]);

    // Slots visibles vs masques (oeil sur la carte).
    const visibleDevices = useMemo(
        () => devices.filter((d) => !hiddenSlotIds.has(d.id)),
        [devices, hiddenSlotIds]
    );
    const hiddenSlotsList = useMemo(
        () => devices.filter((d) => hiddenSlotIds.has(d.id)),
        [devices, hiddenSlotIds]
    );
    // Cards fantomes pour les hw masques (pas dans devices car exclus de
    // linkableHardwareDevices). On les liste a part pour permettre a l'user
    // de les re-afficher.
    const hiddenHwCards = useMemo(
        () => allLinkableHardware.filter((h) => hiddenHwIds.has(h.id)),
        [allLinkableHardware, hiddenHwIds]
    );
    const virtualSystemDevices = useMemo(
        () => hardwareDevices.filter((device) => device.source === "windows" && (device.virtualDevice || isVirtualDeviceName(device.name))),
        [hardwareDevices]
    );
    const hardwareCount = linkableHardwareDevices.length;
    const virtualHardwareCount = virtualSystemDevices.length;

    const getDeviceDisplayName = useCallback(
        (deviceId: string, kind: DeviceKind, fallbackName?: string) => {
            if (deviceId === "keyboard") return fallbackName || "Keyboard";
            if (deviceId === "mouse") return fallbackName || "Mouse";

            const profileDevice = deviceById.get(deviceId) ?? {
                id: deviceId,
                name: fallbackName || deviceNameFromId(deviceId, kind),
                kind,
            };
            const hardware = hardwareForProfileDevice(profileDevice, hardwareDevices);
            if (hardware) return hardware.name;
            return profileDeviceDisplayName({
                id: profileDevice.id,
                kind: profileDevice.kind,
                name: fallbackName || profileDevice.name || deviceNameFromId(deviceId, kind),
            });
        },
        [deviceById, hardwareDevices]
    );

    const getDeviceStatus = useCallback(
        (device: DeviceInfo) => {
            if (device.id === "keyboard" || device.id === "mouse") {
                return { label: "systeme", connected: true, detail: "peripherique standard" };
            }

            if (isVirtualDeviceName(device.name)) {
                const linkedHardwareId = hardwareLinks[device.id];
                if (linkedHardwareId && linkedHardwareId !== AUTO_HARDWARE_LINK) {
                    const linkedHardware = hardwareDevices.find((hardware) => {
                        return hardware.id === linkedHardwareId && isLinkablePhysicalHardware(hardware);
                    });

                    if (linkedHardware) {
                        const [, instance = "1"] = device.id.split(":");
                        return {
                            label: "connecte",
                            connected: true,
                            detail: `${hardwareOptionLabel(linkedHardware)} -> vJoy ${instance}`,
                        };
                    }

                    return {
                        label: "deconnecte",
                        connected: false,
                        detail: "hardware lie absent",
                    };
                }

                const backingHardware = linkedHardwareForVirtualDevice(device, hardwareDevices, hardwareLinks);
                if (backingHardware) {
                    const [, instance = "1"] = device.id.split(":");
                    return {
                        label: "connecte",
                        connected: true,
                        detail: `${hardwareOptionLabel(backingHardware)} -> vJoy ${instance}`,
                    };
                }

                return {
                    label: "deconnecte",
                    connected: false,
                    detail: "vJoy/Gremlin actif, aucun joystick physique detecte",
                };
            }

            const hardware = hardwareForProfileDevice(device, hardwareDevices);
            if (hardware) {
                return {
                    label: "detecte",
                    connected: true,
                    detail: hardware.buttons || hardware.axes
                        ? `${hardware.buttons} boutons - ${hardware.axes} axes`
                        : `${hardware.source} - ${hardware.status || "OK"}`,
                };
            }

            return {
                label: "non detecte",
                connected: false,
                detail: "appuyez sur un bouton pour reveiller le joystick",
            };
        },
        [hardwareDevices, hardwareLinks]
    );

    const visibleRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        return rows.filter((row) => {
            // Bypass : si la row vient juste d'être éditée, on la garde visible
            // tant que les filtres n'ont pas été modifiés (évite le "disparaît après edit").
            if (stickyRowIds.has(row.id)) return true;
            if (!showEmptyActions && !row.hasBinding) return false;
            if (selectedDeviceId !== ALL_DEVICES) {
                if (selectedDeviceId === NO_DEVICE && row.hasBinding) return false;
                // Quand un device spécifique est choisi : on garde les rows liées à ce device,
                // ET les rows vides si le toggle "Actions vides" est ON.
                if (
                    selectedDeviceId !== NO_DEVICE
                    && row.hasBinding
                    && !row.bindings.some((binding) => binding.deviceId === selectedDeviceId)
                ) return false;
                if (
                    selectedDeviceId !== NO_DEVICE
                    && !row.hasBinding
                    && !showEmptyActions
                ) return false;
            }
            if (!query) return true;

            const inputText = row.bindings.map((binding) => `${binding.input} ${formatBindingInput(binding.input)}`).join(" ");
            return [
                row.actionLabel,
                row.actionName,
                row.actionMap,
                inputText,
                getDeviceDisplayName(row.deviceId, row.deviceKind),
            ].some((part) => part.toLowerCase().includes(query));
        });
    }, [getDeviceDisplayName, rows, search, selectedDeviceId, showEmptyActions, stickyRowIds]);

    // Quand un filtre/recherche change, on oublie les rows "sticky" (effet de masquage normal)
    useEffect(() => {
        setStickyRowIds(new Set());
    }, [search, selectedDeviceId, showEmptyActions]);

    const stats = useMemo(() => {
        const bound = rows.filter((row) => row.hasBinding).length;
        return {
            maps: parsed?.actionMapCount ?? 0,
            actions: rows.length,
            bound,
            visible: visibleRows.length,
        };
    }, [parsed?.actionMapCount, rows, visibleRows.length]);

    const openImportDialog = async () => {
        if (!selectedVersion) return;
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: "Bindings", extensions: ["xml", "pak", "p4k", "zip"] }],
            });
            const sourcePath = Array.isArray(selected) ? selected[0] : selected;
            if (!sourcePath || typeof sourcePath !== "string") return;
            const imported = await invoke<BindingFile[]>("import_bindings_file", { sourcePath, version: selectedVersion });
            const nextProfilePath = imported[0]?.path ?? "";
            if (nextProfilePath) {
                rememberSelectedProfilePath(selectedVersion, nextProfilePath);
            }
            toast({
                title: "Import termine",
                description: "Le profil a ete ajoute aux mappings disponibles.",
            });
            await loadProfiles(nextProfilePath);
        } catch (error) {
            toast({
                title: "Import impossible",
                description: toErrorMessage(error),
                variant: "destructive",
            });
        }
    };

    const openBindingsFolder = async () => {
        try {
            await invoke("open_bindings_folder", { version: selectedVersion });
        } catch (error) {
            toast({
                title: "Dossier",
                description: toErrorMessage(error, "Impossible d'ouvrir le dossier."),
                variant: "destructive",
            });
        }
    };

    const saveProfile = async () => {
        if (!selectedProfile || !isDirty) return;
        setIsSaving(true);
        try {
            const writingFromBase = isBaseProfile(selectedProfile);
            const targetPath = writingFromBase
                ? resolveUserProfilePath(profiles, selectedProfile, selectedVersion)
                : selectedProfile.path;
            const targetName = basename(targetPath);

            // Avant ecriture : nettoie les declarations vJoy auto-ajoutees
            // par les anciennes versions de l'app (l'utilisateur n'en veut
            // pas, SC mappe via l'ordre joy.cpl ou via Gremlin).
            const finalXml = stripAutoAddedVjoyDeclarations(xmlContent);
            if (finalXml !== xmlContent) {
                setXmlContent(finalXml);
            }
            await invoke("write_text_file", { path: targetPath, content: finalXml });
            rememberSelectedProfilePath(selectedVersion, targetPath);
            setOriginalXml(finalXml);
            if (writingFromBase) {
                await loadProfiles(targetPath);
            }
            toast({
                title: writingFromBase ? "Profil utilisateur cree" : "Profil sauvegarde",
                description: targetName,
            });
        } catch (error) {
            toast({
                title: "Sauvegarde impossible",
                description: toErrorMessage(error),
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const deleteProfile = async () => {
        if (!selectedProfile) return;
        if (isBaseProfile(selectedProfile)) {
            toast({
                title: "Profil protege",
                description: "La base Data.pak sert de reference et ne se supprime pas depuis l'editeur.",
                variant: "destructive",
            });
            return;
        }
        try {
            await invoke("delete_bindings_file", { filePath: selectedProfile.path });
            toast({
                title: "Profil supprime",
                description: selectedProfile.name,
            });
            setSelectedProfilePath("");
            await loadProfiles("");
        } catch (error) {
            toast({
                title: "Suppression impossible",
                description: toErrorMessage(error),
                variant: "destructive",
            });
        }
    };

    const startEdit = (row: BindingRow) => {
        setEditingRow(row);
        setEditValue("");
    };

    const applyEdit = () => {
        if (!editingRow) return;
        try {
            const editedId = editingRow.id;
            setXmlContent((current) => updateActionBinding(current, editingRow, editValue));
            setStickyRowIds((prev) => new Set(prev).add(editedId));
            setEditingRow(null);
        } catch (error) {
            toast({
                title: "Liaison",
                description: toErrorMessage(error, "Impossible de modifier la liaison."),
                variant: "destructive",
            });
        }
    };

    const clearBinding = (row: BindingRow) => {
        try {
            setXmlContent((current) => updateActionBinding(current, row, ""));
            setStickyRowIds((prev) => new Set(prev).add(row.id));
        } catch (error) {
            toast({
                title: "Liaison",
                description: toErrorMessage(error, "Impossible de supprimer la liaison."),
                variant: "destructive",
            });
        }
    };

    const openCurveEditor = (row: BindingRow) => {
        try {
            setCurveDraft(readCurveSettings(xmlContent, row));
            setCurveRow(row);
        } catch (error) {
            toast({
                title: "Courbe",
                description: toErrorMessage(error, "Impossible de lire la courbe."),
                variant: "destructive",
            });
        }
    };

    const applyCurve = () => {
        if (!curveRow) return;
        try {
            setXmlContent((current) => updateCurveSettings(current, curveRow, curveDraft));
            setCurveRow(null);
        } catch (error) {
            toast({
                title: "Courbe",
                description: toErrorMessage(error, "Impossible de sauvegarder la courbe."),
                variant: "destructive",
            });
        }
    };

    const activeRowsLabel = `${visibleRows.length}/${rows.length}`;

    return (
        <TooltipProvider delayDuration={120}>
            <div className="flex min-h-[calc(100vh-285px)] flex-col gap-2.5">
                <section className="rounded-xl border border-border/45 bg-[hsl(var(--card)/0.34)] p-3 shadow-[0_14px_34px_rgba(0,0,0,0.15)] backdrop-blur-xl">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Badge variant="outline" className="h-6 border-primary/35 bg-primary/12 px-2 text-primary">
                                {selectedVersion || "LIVE"}
                            </Badge>
                            <h2 className="text-base font-semibold tracking-tight">Editeur de liaisons</h2>
                            <span className="hidden text-xs text-muted-foreground md:inline">
                                Base Data.pak automatique, mappings importes au choix.
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:justify-end">
                            <Button variant="outline" className="h-9 gap-2 px-3" onClick={openImportDialog}>
                                <Upload className="h-4 w-4" />
                                Importer
                            </Button>
                            <Button variant="outline" className="h-9 gap-2 px-3" onClick={openBindingsFolder}>
                                <FolderOpen className="h-4 w-4" />
                                Dossier
                            </Button>
                            <Button variant="outline" className="h-9 gap-2 px-3" onClick={() => loadProfiles()} disabled={isLoadingProfiles}>
                                <RefreshCw className={cn("h-4 w-4", isLoadingProfiles && "animate-spin")} />
                                Recharger
                            </Button>
                            <Button variant="outline" className="h-9 gap-2 px-3" onClick={() => void refreshHardwareDevices()} disabled={isRefreshingHardware}>
                                {isRefreshingHardware ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
                                {isRefreshingHardware ? "Scan..." : "Peripheriques"}
                            </Button>
                            <Button className="h-9 gap-2 px-3" onClick={saveProfile} disabled={!isDirty || isSaving || !selectedProfile}>
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                {selectedProfileIsBase ? "Creer XML" : "Sauvegarder"}
                            </Button>
                        </div>
                    </div>

                    {baseError ? (
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span>{baseError}</span>
                        </div>
                    ) : null}

                    <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-center">
                        <div className="min-w-0">
                            <Label className="sr-only">Profil</Label>
                            <Select
                                value={selectedProfilePath || undefined}
                                onValueChange={setSelectedProfilePath}
                                disabled={isLoadingProfiles || profiles.length === 0}
                            >
                                <SelectTrigger className="h-9 rounded-lg bg-[hsl(var(--background)/0.34)] text-sm">
                                    <SelectValue placeholder="Aucun profil disponible" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[420px]">
                                    {profiles.map((profile) => (
                                        <SelectItem key={profile.path} value={profile.path} className="py-2">
                                            <span className="font-medium">{profile.name}</span>
                                            <span className="ml-2 text-muted-foreground">
                                                - {profile.source}{isBaseProfile(profile) ? " (reference)" : ""}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5">
                            {[
                                ["Maps", stats.maps],
                                ["Actions", stats.actions],
                                ["Liees", stats.bound],
                                ["Aff.", stats.visible],
                            ].map(([label, value]) => (
                                <div
                                    key={label}
                                    className="min-w-[72px] rounded-lg border border-border/35 bg-[hsl(var(--background)/0.22)] px-2 py-1.5"
                                >
                                    <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                        {label}
                                    </p>
                                    <p className="mt-0.5 text-base font-semibold leading-none">{value}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                        <button
                            type="button"
                            onClick={() => setSelectedDeviceId(ALL_DEVICES)}
                            className={cn(
                                "flex h-12 min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                                selectedDeviceId === ALL_DEVICES
                                    ? "border-primary/45 bg-primary/14 text-foreground"
                                    : "border-border/35 bg-[hsl(var(--background)/0.18)] text-muted-foreground hover:bg-[hsl(var(--background)/0.28)]"
                            )}
                        >
                            <Cpu className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">Tous les peripheriques</span>
                                <span className="text-[11px] text-muted-foreground">
                                    {activeRowsLabel} actions - {hardwareCount} HW{virtualHardwareCount ? ` - ${virtualHardwareCount} virtuel${virtualHardwareCount > 1 ? "s" : ""}` : ""}
                                </span>
                            </span>
                        </button>
                        {visibleDevices.map((device) => {
                            const Icon = deviceIcon(device.kind);
                            const status = getDeviceStatus(device);
                            const displayName = getDeviceDisplayName(device.id, device.kind, device.name);
                            const isVirtualProfileDevice = isVirtualDeviceName(device.name);
                            const isHidable = device.id !== "keyboard" && device.id !== "mouse";
                            const toggleHidden = () => {
                                // Pour les cards auto-creees (avec hw associe), on masque
                                // le HW : ca libere son slot et la numerotation se resserre
                                // (joystick:3 = Sol-R [R] devient joystick:2 si on masque MOZA).
                                // Pour les vJoy declarees du profil (pas de hw lie), on masque
                                // simplement le slot.
                                const linkedHwId = slotToHw.get(device.id);
                                if (linkedHwId) {
                                    setHiddenHwIdsAndSave((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(linkedHwId)) next.delete(linkedHwId); else next.add(linkedHwId);
                                        return next;
                                    });
                                } else {
                                    setHiddenSlotIdsAndSave((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(device.id)) next.delete(device.id); else next.add(device.id);
                                        return next;
                                    });
                                }
                            };
                            const hardwareOptions = linkableHardwareDevices.filter((hardware) => {
                                if (device.kind === "joystick") return hardware.kind === "joystick";
                                if (device.kind === "gamepad") return hardware.kind === "gamepad";
                                return false;
                            });
                            const selectedHardwareLink = hardwareLinks[device.id] ?? AUTO_HARDWARE_LINK;
                            const selectedHardwareIsMissing = selectedHardwareLink !== AUTO_HARDWARE_LINK
                                && !hardwareOptions.some((hardware) => hardware.id === selectedHardwareLink);
                            const autoLinkedHardware = isVirtualProfileDevice
                                ? physicalHardwareForVirtualDevice(device, hardwareDevices)
                                : null;
                            const cardClassName = cn(
                                "min-w-0 rounded-lg border text-left transition-colors",
                                selectedDeviceId === device.id
                                    ? "border-primary/45 bg-primary/14 text-foreground"
                                    : "border-border/35 bg-[hsl(var(--background)/0.18)] text-muted-foreground hover:bg-[hsl(var(--background)/0.28)]"
                            );
                            const deviceSummary = (
                                <>
                                    <Icon className="h-3.5 w-3.5 shrink-0" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[13px] font-medium">{displayName}</span>
                                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                            <span
                                                className={cn(
                                                    "h-1.5 w-1.5 shrink-0 rounded-full",
                                                    status.connected ? "bg-emerald-400" : "bg-amber-400"
                                                )}
                                            />
                                            <span className={status.connected ? "text-emerald-300/90" : "text-amber-300/90"}>
                                                {status.label}
                                            </span>
                                            <span className="truncate">
                                                {status.detail || `${device.bindingCount} liaison${device.bindingCount > 1 ? "s" : ""}`}
                                            </span>
                                        </span>
                                    </span>
                                </>
                            );

                            // Cards keyboard/mouse : pas de dropdown Lie a (pas de hw a choisir)
                            const showLinkDropdown = device.kind === "joystick" || device.kind === "gamepad";

                            if (!showLinkDropdown) {
                                return (
                                    <div
                                        key={device.id}
                                        className="relative h-12"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setSelectedDeviceId(device.id)}
                                            title={`${displayName} - ${status.label}${status.detail ? ` - ${status.detail}` : ""}`}
                                            className={cn("flex h-12 w-full items-center gap-2 px-2.5 py-1.5", cardClassName)}
                                        >
                                            {deviceSummary}
                                        </button>
                                    </div>
                                );
                            }

                            return (
                                <div
                                    key={device.id}
                                    title={`${displayName} - ${status.label}${status.detail ? ` - ${status.detail}` : ""}`}
                                    className={cn("relative h-[74px] px-2.5 py-1.5", cardClassName)}
                                >
                                    {isHidable && (
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); toggleHidden(); }}
                                            title="Masquer ce slot"
                                            className="absolute top-1 right-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-background/60 hover:text-foreground"
                                        >
                                            <EyeOff className="h-3 w-3" />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setSelectedDeviceId(device.id)}
                                        className="flex w-full min-w-0 items-center gap-2 text-left"
                                    >
                                        {deviceSummary}
                                    </button>
                                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                                        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">Lie a</span>
                                        <Select
                                            value={selectedHardwareLink}
                                            onValueChange={(value) => {
                                                setHardwareLinks((current) => {
                                                    const next = { ...current };
                                                    if (value === AUTO_HARDWARE_LINK) delete next[device.id];
                                                    else next[device.id] = value;
                                                    return next;
                                                });
                                            }}
                                        >
                                            <SelectTrigger className="h-6 min-w-0 flex-1 rounded-md border-border/35 bg-[hsl(var(--background)/0.32)] px-2 text-[11px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value={AUTO_HARDWARE_LINK}>
                                                    Auto{autoLinkedHardware ? ` - ${hardwareOptionLabel(autoLinkedHardware)}` : " - auto"}
                                                </SelectItem>
                                                {hardwareOptions.map((hardware) => (
                                                    <SelectItem key={hardware.id} value={hardware.id}>
                                                        {hardwareOptionLabel(hardware)}
                                                    </SelectItem>
                                                ))}
                                                {selectedHardwareIsMissing ? (
                                                    <SelectItem value={selectedHardwareLink} disabled>Hardware absent</SelectItem>
                                                ) : null}
                                                {!hardwareOptions.length ? (
                                                    <SelectItem value="no-hardware" disabled>Aucun hardware physique</SelectItem>
                                                ) : null}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            );
                        })}
                        {hiddenSlotsList.map((device) => {
                            const displayName = getDeviceDisplayName(device.id, device.kind, device.name);
                            return (
                                <div
                                    key={`hidden:${device.id}`}
                                    className="relative flex h-12 items-center gap-2 rounded-lg border border-dashed border-border/35 bg-[hsl(var(--background)/0.10)] px-2.5 py-1.5 text-muted-foreground/70 opacity-60"
                                    title={`${displayName} - masque`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setHiddenSlotIdsAndSave((prev) => {
                                                const next = new Set(prev);
                                                next.delete(device.id);
                                                return next;
                                            });
                                        }}
                                        title="Reafficher ce slot"
                                        className="absolute top-1 right-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-background/60 hover:text-foreground"
                                    >
                                        <Eye className="h-3 w-3" />
                                    </button>
                                    <Gamepad2 className="h-3.5 w-3.5 shrink-0" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[13px] font-medium">{displayName}</span>
                                        <span className="block text-[11px] text-muted-foreground/60">masque</span>
                                    </span>
                                </div>
                            );
                        })}
                        {hiddenHwCards.map((hw) => (
                            <div
                                key={`hidden-hw:${hw.id}`}
                                className="relative flex h-12 items-center gap-2 rounded-lg border border-dashed border-border/35 bg-[hsl(var(--background)/0.10)] px-2.5 py-1.5 text-muted-foreground/70 opacity-60"
                                title={`${hw.name} - masque`}
                            >
                                <button
                                    type="button"
                                    onClick={() => {
                                        setHiddenHwIdsAndSave((prev) => {
                                            const next = new Set(prev);
                                            next.delete(hw.id);
                                            return next;
                                        });
                                    }}
                                    title="Reafficher ce hardware"
                                    className="absolute top-1 right-1 z-10 inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-background/60 hover:text-foreground"
                                >
                                    <Eye className="h-3 w-3" />
                                </button>
                                <Gamepad2 className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[13px] font-medium">{hw.name}</span>
                                    <span className="block text-[11px] text-muted-foreground/60">masque</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-border/45 bg-[hsl(var(--card)/0.30)] shadow-[0_18px_46px_rgba(0,0,0,0.16)] backdrop-blur-xl">
                    <div className="grid gap-3 border-b border-border/35 p-3 xl:grid-cols-[minmax(260px,1fr)_230px_220px_auto] xl:items-end">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Recherche</Label>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Action, touche, peripherique..."
                                    className="h-11 rounded-xl bg-[hsl(var(--background)/0.30)] pl-9 text-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Peripherique</Label>
                            <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                                <SelectTrigger className="h-11 rounded-xl bg-[hsl(var(--background)/0.30)]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_DEVICES}>Tous</SelectItem>
                                    <SelectItem value={NO_DEVICE}>Non attribue</SelectItem>
                                    {devices.map((device) => (
                                        <SelectItem key={device.id} value={device.id}>
                                            {getDeviceDisplayName(device.id, device.kind, device.name)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex h-11 items-center justify-between gap-3 rounded-xl border border-border/35 bg-[hsl(var(--background)/0.24)] px-3">
                            <div>
                                <p className="text-sm font-medium">Actions vides</p>
                                <p className="text-xs text-muted-foreground">Afficher les non attribuees</p>
                            </div>
                            <Switch checked={showEmptyActions} onCheckedChange={setShowEmptyActions} />
                        </div>

                        <div className="flex h-11 items-center rounded-xl border border-border/35 bg-[hsl(var(--background)/0.18)] px-3 text-xs text-muted-foreground">
                            <span>
                                Ecriture profil: <span className="font-medium text-foreground">rebind</span>
                            </span>
                        </div>
                    </div>

                    <div className="min-h-[540px] max-h-[calc(100vh-340px)] overflow-auto">
                        {isLoadingXml || isLoadingProfiles ? (
                            <div className="flex min-h-[520px] items-center justify-center gap-3 text-sm text-muted-foreground">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                Chargement des liaisons...
                            </div>
                        ) : parsedResult.error ? (
                            <div className="flex min-h-[520px] items-center justify-center p-6">
                                <div className="max-w-xl rounded-xl border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive-foreground">
                                    {parsedResult.error}
                                </div>
                            </div>
                        ) : rows.length === 0 ? (
                            <div className="flex min-h-[520px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
                                Aucun profil lisible. Importez un XML ou verifiez le Data.pak de cette version.
                            </div>
                        ) : (
                            <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-sm">
                                <thead className="sticky top-0 z-10 bg-[hsl(var(--background)/0.78)] backdrop-blur-xl">
                                    <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                        <th className="w-14 border-b border-border/35 px-4 py-3">Fav</th>
                                        <th className="border-b border-border/35 px-4 py-3">Action</th>
                                        <th className="w-44 border-b border-border/35 px-4 py-3">Appareil</th>
                                        <th className="w-64 border-b border-border/35 px-4 py-3">Liaison</th>
                                        <th className="w-36 border-b border-border/35 px-4 py-3 text-right">Options</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleRows.map((row) => {
                                        const displayBinding = selectedDeviceId === ALL_DEVICES
                                            ? row.bindings[0]
                                            : row.bindings.find((binding) => binding.deviceId === selectedDeviceId) ?? row.bindings[0];
                                        const displayDeviceId = displayBinding?.deviceId ?? row.deviceId;
                                        const displayDeviceKind = displayBinding?.deviceKind ?? row.deviceKind;
                                        const Icon = deviceIcon(displayDeviceKind);
                                        const firstBinding = displayBinding?.input ?? "";
                                        // Si la binding pointe vers un slot joystick/gamepad inexistant
                                        // (genre js6 alors qu'on a que 2 sticks), OU vers un slot
                                        // que l'utilisateur a masque (genre MOZA / Keychron qu'il
                                        // ne considere pas comme un vrai joystick), on traite
                                        // l'action comme orpheline : "Non attribue".
                                        const isOrphanBinding = row.hasBinding
                                            && (displayDeviceKind === "joystick" || displayDeviceKind === "gamepad")
                                            && (!deviceById.has(displayDeviceId) || hiddenSlotIds.has(displayDeviceId));
                                        const displayDevice = deviceById.get(displayDeviceId) ?? {
                                            id: displayDeviceId,
                                            name: deviceNameFromId(displayDeviceId, displayDeviceKind),
                                            kind: displayDeviceKind,
                                            bindingCount: 0,
                                        };
                                        const deviceStatus = getDeviceStatus(displayDevice);
                                        const deviceLabel = getDeviceDisplayName(displayDeviceId, displayDeviceKind);
                                        const extraBindingCount = selectedDeviceId === ALL_DEVICES ? Math.max(row.bindings.length - 1, 0) : 0;
                                        return (
                                            <tr
                                                key={row.id}
                                                className="group border-b border-border/25 transition-colors hover:bg-primary/6"
                                            >
                                                <td className="border-b border-border/18 px-4 py-3 align-middle">
                                                    <button
                                                        type="button"
                                                        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/12 hover:text-primary"
                                                        aria-label="Favori"
                                                    >
                                                        <Heart className="h-4 w-4" />
                                                    </button>
                                                </td>
                                                <td className="border-b border-border/18 px-4 py-3 align-middle">
                                                    <p className="text-[15px] font-semibold leading-tight text-foreground">
                                                        {row.actionLabel}
                                                    </p>
                                                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                                        <span className="font-mono">{row.actionName}</span>
                                                        <span>{row.actionMap}</span>
                                                    </p>
                                                </td>
                                                <td className="border-b border-border/18 px-4 py-3 align-middle">
                                                    {row.hasBinding && !isOrphanBinding ? (
                                                        <span
                                                            className={cn(
                                                                "inline-flex max-w-[210px] items-center gap-1.5 rounded-lg bg-[hsl(var(--background)/0.42)] px-2.5 py-1 text-xs font-medium",
                                                                displayDeviceId !== "keyboard" && displayDeviceId !== "mouse" && !deviceStatus.connected && "text-amber-200"
                                                            )}
                                                            title={`${deviceLabel} - ${deviceStatus.label}${deviceStatus.detail ? ` - ${deviceStatus.detail}` : ""}`}
                                                        >
                                                            <Icon className="h-3.5 w-3.5" />
                                                            <span className="truncate">{deviceLabel}</span>
                                                            {extraBindingCount > 0 ? (
                                                                <span className="text-[10px] text-muted-foreground">+{extraBindingCount}</span>
                                                            ) : null}
                                                            {displayDeviceId !== "keyboard" && displayDeviceId !== "mouse" ? (
                                                                <span
                                                                    className={cn(
                                                                        "h-1.5 w-1.5 shrink-0 rounded-full",
                                                                        deviceStatus.connected ? "bg-emerald-400" : "bg-amber-400"
                                                                    )}
                                                                />
                                                            ) : null}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-1 text-xs text-amber-200">
                                                            <AlertTriangle className="h-3.5 w-3.5" />
                                                            Non attribue
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="border-b border-border/18 px-4 py-3 align-middle">
                                                    <button
                                                        type="button"
                                                        onClick={() => startEdit(row)}
                                                        className={cn(
                                                            "max-w-full truncate rounded-lg px-2.5 py-1.5 text-left font-mono text-sm transition-colors",
                                                            row.hasBinding && !isOrphanBinding
                                                                ? "bg-primary/10 text-primary hover:bg-primary/16"
                                                                : "bg-[hsl(var(--background)/0.28)] text-muted-foreground hover:text-foreground"
                                                        )}
                                                    >
                                                        {isOrphanBinding ? "Non attribue" : formatBindingInput(firstBinding)}
                                                    </button>
                                                </td>
                                                <td className="border-b border-border/18 px-4 py-3 align-middle">
                                                    <div className="flex justify-end gap-1.5">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-9 w-9 rounded-lg"
                                                                    onClick={() => startEdit(row)}
                                                                >
                                                                    <PenLine className="h-4 w-4" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Modifier la liaison</TooltipContent>
                                                        </Tooltip>

                                                        {row.canEditCurve ? (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-9 w-9 rounded-lg"
                                                                        onClick={() => openCurveEditor(row)}
                                                                    >
                                                                        <SlidersHorizontal className="h-4 w-4" />
                                                                    </Button>
                                                                </TooltipTrigger>
                                                                <TooltipContent>Courbe et zones</TooltipContent>
                                                            </Tooltip>
                                                        ) : null}

                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-9 w-9 rounded-lg text-muted-foreground hover:text-destructive"
                                                                    onClick={() => clearBinding(row)}
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>Supprimer la liaison</TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </section>

                <Dialog open={Boolean(editingRow)} onOpenChange={(openState) => !openState && setEditingRow(null)}>
                    <DialogContent className="max-w-xl">
                        <DialogHeader>
                            <DialogTitle>Modifier la liaison</DialogTitle>
                            <DialogDescription>
                                Appuyez sur une touche, un bouton souris ou un bouton de manette.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                            <div className="rounded-xl border border-border/35 bg-[hsl(var(--background)/0.24)] p-3">
                                <p className="text-sm font-semibold">{editingRow?.actionLabel}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {editingRow?.actionName} {editingRow ? `- ${editingRow.actionMap}` : ""}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-primary/25 bg-primary/8 p-4">
                                <div className="flex min-h-24 items-center justify-center rounded-xl border border-border/35 bg-[hsl(var(--background)/0.48)] px-4 text-center">
                                    <span className={cn("text-base font-medium", editValue ? "text-foreground" : "text-muted-foreground")}>
                                        {editValue ? formatBindingInput(editValue) : "En ecoute..."}
                                    </span>
                                </div>
                                {editValue ? (
                                    <p className="mt-2 text-center font-mono text-xs text-muted-foreground">{editValue}</p>
                                ) : null}
                            </div>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setEditValue("")} disabled={!editValue} className="gap-2">
                                <RotateCcw className="h-4 w-4" />
                                Reinitialiser
                            </Button>
                            <Button onClick={applyEdit} disabled={!editValue}>Appliquer</Button>
                            <Button variant="secondary" onClick={() => setEditingRow(null)}>Annuler</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog open={Boolean(curveRow)} onOpenChange={(openState) => !openState && setCurveRow(null)}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Courbe du peripherique</DialogTitle>
                            <DialogDescription>
                                Reglages disponibles uniquement pour les axes et actions qui declarent une courbe.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_250px]">
                            <div className="rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.28)] p-3">
                                <div className="mb-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                                    <span>{curveRow?.actionLabel}</span>
                                    <span>EXP: {formatNumber(curveDraft.exponent)}</span>
                                </div>
                                <svg viewBox="0 0 100 100" className="aspect-square w-full rounded-xl bg-[hsl(var(--background)/0.70)]">
                                    {Array.from({ length: 11 }).map((_, index) => (
                                        <g key={index}>
                                            <line x1={index * 10} x2={index * 10} y1="0" y2="100" stroke="hsl(var(--border))" strokeOpacity="0.35" strokeWidth="0.35" />
                                            <line x1="0" x2="100" y1={index * 10} y2={index * 10} stroke="hsl(var(--border))" strokeOpacity="0.35" strokeWidth="0.35" />
                                        </g>
                                    ))}
                                    <polyline
                                        points={curvePath(curveDraft)}
                                        fill="none"
                                        stroke="hsl(var(--primary))"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-border/35 bg-[hsl(var(--background)/0.22)] p-4">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label>Facteur de courbe</Label>
                                        <span className="font-mono text-sm">{formatNumber(curveDraft.exponent)}</span>
                                    </div>
                                    <Slider
                                        min={0.2}
                                        max={3}
                                        step={0.05}
                                        value={[curveDraft.exponent]}
                                        onValueChange={([value]) => setCurveDraft((current) => ({ ...current, exponent: value }))}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label>Zone morte</Label>
                                        <span className="font-mono text-sm">{formatNumber(curveDraft.deadzone)}</span>
                                    </div>
                                    <Slider
                                        min={0}
                                        max={0.5}
                                        step={0.01}
                                        value={[curveDraft.deadzone]}
                                        onValueChange={([value]) => setCurveDraft((current) => ({ ...current, deadzone: value }))}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label>Saturation</Label>
                                        <span className="font-mono text-sm">{formatNumber(curveDraft.saturation)}</span>
                                    </div>
                                    <Slider
                                        min={0.1}
                                        max={1}
                                        step={0.01}
                                        value={[curveDraft.saturation]}
                                        onValueChange={([value]) => setCurveDraft((current) => ({ ...current, saturation: value }))}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => setCurveDraft((current) => ({ ...current, exponent: 1 }))}
                                    >
                                        Lineaire
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => setCurveDraft({ exponent: 1, deadzone: 0, saturation: 1 })}
                                    >
                                        Reset
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button onClick={applyCurve}>Enregistrer</Button>
                            <Button variant="secondary" onClick={() => setCurveRow(null)}>Annuler</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {selectedProfile && profiles.length > 1 && !selectedProfileIsBase ? (
                    <div className="flex justify-end">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={deleteProfile}
                        >
                            <Trash2 className="h-4 w-4" />
                            Supprimer le profil selectionne
                        </Button>
                    </div>
                ) : null}
            </div>
        </TooltipProvider>
    );
}
