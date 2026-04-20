const puppeteer = require("puppeteer");
const fs = require("fs");
const os = require("os");
const path = require("path");

let browserPromise = null;
let browserUserDataDir = null;

const launchArgs = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--font-render-hinting=none",
];

const resolveExecutablePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  try {
    return puppeteer.executablePath();
  } catch (error) {
    return undefined;
  }
};

const cleanupUserDataDir = () => {
  if (!browserUserDataDir) return;
  try {
    fs.rmSync(browserUserDataDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup failures for temp browser profiles.
  } finally {
    browserUserDataDir = null;
  }
};

const getBrowser = async () => {
  if (!browserPromise) {
    browserUserDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `billing-pdf-${process.pid}-`),
    );

    browserPromise = puppeteer
      .launch({
        headless: true,
        executablePath: resolveExecutablePath(),
        userDataDir: browserUserDataDir,
        args: launchArgs,
      })
      .then((browser) => {
        browser.on("disconnected", () => {
          browserPromise = null;
          cleanupUserDataDir();
        });
        return browser;
      })
      .catch((error) => {
        browserPromise = null;
        cleanupUserDataDir();
        throw error;
      });
  }
  return browserPromise;
};

const renderPdfBuffer = async (html, pdfOptions = {}) => {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "load"],
      timeout: 0,
    });
    await page.emulateMediaType("screen");
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "12mm",
        right: "10mm",
        bottom: "12mm",
        left: "10mm",
      },
      ...pdfOptions,
    });
  } finally {
    await page.close();
  }
};

const sendPdfResponse = async (res, { html, filename, pdfOptions }) => {
  const buffer = await renderPdfBuffer(html, pdfOptions);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=${filename}`);
  res.setHeader("Content-Length", buffer.length);
  res.end(buffer);
};

module.exports = {
  renderPdfBuffer,
  sendPdfResponse,
};
