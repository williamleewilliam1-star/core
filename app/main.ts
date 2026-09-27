import { BrowserWindow, Notification as ENotification, Menu, Tray, app, clipboard, ipcMain, session, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as url from 'url';
import packageJson from '../package.json';
import { loadRecords, saveRecords } from './lib/storage.js';
import { processUrl } from './lib/vault.js';
import { getAllAddresses, verifyAddress, verifyXpub } from './lib/verify-address.js';
import { decodeLightningPayment } from './lib/lightning.js';
import { buildNetworkAuditReport, DEFAULT_ALLOWED_NETWORK_HOSTS } from './lib/network-audit.js';

const networkAuditEnabled = process.env['BRANTA_NETWORK_AUDIT'] === '1';

if (process.platform != 'win32' && !networkAuditEnabled) {
    const AutoLaunch = require('auto-launch');

    let autoLaunch = new AutoLaunch({
        name: 'Branta',
        path: app.getPath('exe'),
        isHidden: true
    });

    autoLaunch.isEnabled().then((_isEnabled: boolean) => {
        autoLaunch.enable();
    });

    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('branta', process.execPath, [path.resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient('branta');
    }
}

let mainWindow: any;
let networkAuditStarted = false;

function startNetworkAudit() {
    if (!networkAuditEnabled || networkAuditStarted) return;

    networkAuditStarted = true;
    const observedUrls = new Set<string>();
    const extraAllowedHosts = (process.env['BRANTA_NETWORK_AUDIT_ALLOWED_HOSTS'] ?? '')
        .split(',')
        .map(host => host.trim())
        .filter(Boolean);
    const allowedHosts = [...DEFAULT_ALLOWED_NETWORK_HOSTS, ...extraAllowedHosts];

    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (details, callback) => {
            observedUrls.add(details.url);
            callback({ cancel: false });
        }
    );
    const seconds = Math.max(1, Number(process.env['BRANTA_NETWORK_AUDIT_SECONDS'] ?? '10'));
    const outputPath = path.resolve(process.env['BRANTA_NETWORK_AUDIT_PATH'] ?? 'network-audit.json');

    setTimeout(() => {
        const report = buildNetworkAuditReport(observedUrls, allowedHosts);
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
        console.log(`[network-audit] wrote ${outputPath}`);
        console.log(`[network-audit] observed: ${report.observedOrigins.join(', ') || '(none)'}`);

        if (report.unexpectedOrigins.length > 0) {
            console.error(`[network-audit] unexpected: ${report.unexpectedOrigins.join(', ')}`);
            process.exitCode = 2;
        }
        else {
            console.log('[network-audit] PASS: no unexpected remote origins');
        }

        forceQuit();
    }, seconds * 1000);
}

function kickoffClipboard() {
    let previousText: string | null = null;

    setInterval(() => {
        const currentText = clipboard.readText();
        if (currentText != previousText) {
            previousText = currentText;
            mainWindow.webContents.send('clipboard-updated', currentText);
        }
    }, 300);
}

function openUrl(url: string) {
    shell.openExternal(url);
}

let isForceQuit = false;

function forceQuit() {
    isForceQuit = true;
    app.quit();
}

function getByPlatform(options: any, defaultValue = undefined) {
    switch (process.platform) {
        case 'win32':
            return options.windows ?? defaultValue;
        case 'darwin':
            return options.macos ?? defaultValue;
        case 'linux':
            return options.linux ?? defaultValue;
        default:
            return defaultValue;
    }
}

function getTrayIcon() {
    let file;
    switch (process.platform) {
        case 'win32':
            file = 'icon.ico';
            break;
        case 'darwin':
            file = 'tray-mac.png';
            break;
        default:
            file = 'icon.png';
            break;
    }

    return getIcon(file);
}

function getIcon(file: string) {
    return process.env['APP_DEV'] ? path.join(__dirname, 'resources', file) : path.join(process.resourcesPath, file);
}

function createWindow() {
    startNetworkAudit();
    const icon = getIcon('icon.png');

    if (process.platform === 'darwin') {
        app.dock.hide();
    }

    mainWindow = new BrowserWindow({
        title: 'Branta',
        width: 700,
        minWidth: 700,
        height: 620,
        minHeight: 620,
        show: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#1b1b1b',
            symbolColor: '#ffffff',
            height: getByPlatform({
                linux: 40,
            })
        },
        autoHideMenuBar: true,
        backgroundColor: '#1b1b1b',
        icon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true
        }
    });

    var splash = new BrowserWindow({
        width: 691,
        height: 483,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        show: false
    });

    splash.loadFile('./resources/splash.html');

    splash.show();

    if (process.env['APP_DEV']) {
        mainWindow.loadURL('http://localhost:4200');
    } else {
        mainWindow.loadURL(
            url.format({
                pathname: path.join(__dirname, `../../dist/branta/browser/index.html`),
                protocol: 'file:',
                slashes: true
            })
        );
    }

    ipcMain.handle('show-notification', (_event, title, body) => {
        const notification = new ENotification({
            title,
            body,
            icon
        });

        notification.on('click', () => {
            mainWindow?.show();
        });

        notification.show();
    });

    ipcMain.handle('verify-address', (_event, wallets, address) => {
        return verifyAddress(wallets, address);
    });

    ipcMain.handle('verify-xpub', (_event, xpub) => {
        return verifyXpub(xpub);
    });

    ipcMain.handle('store-data', async (_event, name, data) => {
        saveRecords(name, data);
        return true;
    });

    ipcMain.handle('retrieve-data', async (_event, name) => {
        return loadRecords(name);
    });

    ipcMain.handle('open-url', async (_event, url) => openUrl(url));

    ipcMain.handle('get-all-addresses', async (_event, wallet, i) => getAllAddresses(wallet, i));

    ipcMain.handle('decode-lightning', async (_event, payment) => decodeLightningPayment(payment));

    mainWindow.on('closed', function() {
        mainWindow = null;
    });

    mainWindow.on('close', (event: any) => {
        if (process.platform == 'linux') {
            app.quit();
            return;
        }

        if (!isForceQuit) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.webContents.once('dom-ready', () => {
        splash.close();

        if (!process.argv.includes('headless')) {
            mainWindow.show();
            // processUrl(mainWindow, process.argv);
        }

        kickoffClipboard();
    });

    if (process.platform != 'linux') {
        let tray = new Tray(getTrayIcon());

        const contextMenu = Menu.buildFromTemplate([
            { label: 'Open', type: 'normal', click: () => mainWindow.show() },
            { label: 'Help', type: 'normal', click: () => openUrl('https://developer.branta.pro/branta-core') },
            { label: '', type: 'separator' },
            { label: 'Quit', type: 'normal', click: forceQuit },
            { label: `Version ${packageJson.version}`, type: 'normal', enabled: false }
        ]);

        tray.setToolTip(packageJson.productName);
        tray.setContextMenu(contextMenu);

        tray.on('click', () => {
            mainWindow.show();
        });
    }
}

app.setAppUserModelId('Branta');

const gotTheLock = app.requestSingleInstanceLock();

if (process.platform == 'linux' ||
    process.platform === 'darwin') {
    app.on('open-url', (event, url) => {
        // processUrl(mainWindow, [url]);
    });
}

if (!gotTheLock) {
    isForceQuit = true;
    app.quit();
} else {
    app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            // processUrl(mainWindow, _commandLine);
        }
    });

    app.on('ready', createWindow);

    app.on('window-all-closed', function() {
        if (process.platform !== 'darwin') app.quit();
    });

    app.on('activate', function() {
        if (mainWindow === null) {
            createWindow();
        }
        else if (process.platform == 'darwin') {
            mainWindow.show();
        }
    });

    app.on('before-quit', (e) => {
        if (process.platform === 'darwin') {
            app.quit();
        }
    });
}
