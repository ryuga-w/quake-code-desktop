const fs = require('fs');
const path = require('path');

function patchFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return false;
  let text = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const [pattern, replacement] of replacements) {
    const next = text.replace(pattern, replacement);
    if (next !== text) {
      text = next;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, text, 'utf8');
  }
  return changed;
}

function patchOauthPage(filePath) {
  return patchFile(filePath, [
    [
      /const LOGO_SVG = `[\s\S]*?`;/,
      'const LOGO_SVG = `<div style="display:flex; flex-direction:column; align-items:center; gap:10px;"><div style="width:12px; height:12px; border-radius:999px; background:#9ad08f; box-shadow:0 0 0 6px rgba(154,208,143,0.12);"></div><div style="font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, Roboto, &quot;Helvetica Neue&quot;, Arial, sans-serif; font-size: 40px; line-height: 1; font-weight: 700; letter-spacing: -0.035em; color: #111827;">Quake Code</div></div>`;'
    ],
    [/--text: #fafafa;/g, '--text: #111827;'],
    [/--text-dim: #a1a1aa;/g, '--text-dim: #4b5563;'],
    [/--page-bg: #09090b;/g, '--page-bg: #ffffff;'],
    [/html \{ color-scheme: dark; \}/g, 'html { color-scheme: light; }'],
    [/title: "Authentication successful"/g, 'title: "Quake authentication successful"'],
    [/max-width: 560px;/g, 'max-width: 620px;'],
    [/width: 72px;\s*\n\s*height: 72px;\s*\n/g, ''],
    [/margin-bottom: 24px;/g, 'margin-bottom: 28px;'],
    [/margin: 0 0 10px;/g, 'margin: 0 0 12px;'],
    [/font-size: 28px;/g, 'font-size: 34px;'],
    [/line-height: 1\.15;/g, 'line-height: 1.08;'],
    [/font-weight: 650;/g, 'font-weight: 700;'],
    [/font-size: 15px;/g, 'font-size: 16px;'],
  ]);
}

function patchOpenAICodexOauth(filePath) {
  return patchFile(filePath, [
    [/originator = "pi"/g, 'originator = "quake-code"'],
    [/@param options\.originator - OAuth originator parameter \(defaults to "pi"\)/g, '@param options.originator - OAuth originator parameter (defaults to "quake-code")'],
    [/OpenAI authentication completed\. You can close this window\./g, 'Quake Code authentication completed. You can close this window.'],
  ]);
}

function patchOpenAICodexResponses(filePath) {
  return patchFile(filePath, [
    [/headers\.set\("originator", "pi"\);/g, 'headers.set("originator", "quake-code");'],
    [/`pi \(\$\{_os\.platform\(\)\} \$\{_os\.release\(\)\}; \$\{_os\.arch\(\)\}\)`/g, '`quake-code (${_os.platform()} ${_os.release()}; ${_os.arch()})`'],
    [/"pi \(browser\)"/g, '"quake-code (browser)"'],
  ]);
}

function main() {
  const root = __dirname ? path.resolve(__dirname, '..') : process.cwd();
  const oauthPageCandidates = [
    path.join(root, 'node_modules', '@mariozechner', 'pi-ai', 'dist', 'utils', 'oauth', 'oauth-page.js'),
    path.join(root, 'node_modules', '@mrquake', 'quakecode-cli', 'node_modules', '@mariozechner', 'pi-ai', 'dist', 'utils', 'oauth', 'oauth-page.js'),
  ];
  const codexOauthCandidates = [
    path.join(root, 'node_modules', '@mariozechner', 'pi-ai', 'dist', 'utils', 'oauth', 'openai-codex.js'),
    path.join(root, 'node_modules', '@mrquake', 'quakecode-cli', 'node_modules', '@mariozechner', 'pi-ai', 'dist', 'utils', 'oauth', 'openai-codex.js'),
  ];
  const codexResponseCandidates = [
    path.join(root, 'node_modules', '@mariozechner', 'pi-ai', 'dist', 'providers', 'openai-codex-responses.js'),
    path.join(root, 'node_modules', '@mrquake', 'quakecode-cli', 'node_modules', '@mariozechner', 'pi-ai', 'dist', 'providers', 'openai-codex-responses.js'),
  ];

  let patchedOauthPageAny = false;
  for (const file of oauthPageCandidates) {
    try {
      patchedOauthPageAny = patchOauthPage(file) || patchedOauthPageAny;
    } catch (err) {
      // ignore
    }
  }

  let patchedCodexAny = false;
  for (const file of codexOauthCandidates) {
    try {
      patchedCodexAny = patchOpenAICodexOauth(file) || patchedCodexAny;
    } catch (err) {
      // ignore
    }
  }
  for (const file of codexResponseCandidates) {
    try {
      patchedCodexAny = patchOpenAICodexResponses(file) || patchedCodexAny;
    } catch (err) {
      // ignore
    }
  }

  if (patchedOauthPageAny) {
    console.log('Quake postinstall: patched OAuth success page branding.');
  }
  if (patchedCodexAny) {
    console.log('Quake postinstall: patched OpenAI Codex branding.');
  }
}

main();
