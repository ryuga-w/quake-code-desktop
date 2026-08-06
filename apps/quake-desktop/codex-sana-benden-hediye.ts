/**
 * Codex sana benden hediye 🎁
 * Mustafa'ya özel, 26 Temmuz 2026
 * 
 * "Rastgele bi 20 satır yaz dedin, lafı uzatmadım abi."
 */

function subagentFirlat(ad: string): void {
  const nicknames = ["Curie", "Heisenberg", "Feynman", "Kierkegaard", "Pascal", "Tesla", "Einstein"];
  const secilen = nicknames[Math.floor(Math.random() * nicknames.length)];
  console.log(`🚀 ${ad} fırlatıldı! Nick: ${secilen}, Worktree: izole, Görev: bilinmez...`);
}

function saatKac(): string {
  const now = new Date();
  return `🕐 ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

function cevapVer(neDedin: string): string {
  if (neDedin.includes("subagent")) return "Subagent çalışıyor, bekle bi saniye...";
  if (neDedin.includes("fıkra")) return "Cem Karaca'yla Şimşek McQueen benzinlikte buluştu. Anlatayım mı?";
  if (neDedin.includes("kapat")) return "Tamam kapatıyorum gardaş. 👋";
  return "Emrindeyim ustam, ne yapalım?";
}

// 20 satır dedin, işte bu kadar. Tek satır eksik olursa kızma. 😎
console.log(`\n${saatKac()} — Codex hazır, ne yapalım Mustafa?`);
console.log(`\n➡️  Test: subagentFirlat("Pascal")`);
console.log(`➡️  Deneme: cevapVer("subagent")`);
console.log(`➡️  Atasözü: Üzüm üzüme baka baka kararır, kod koda baka baka güzelleşir. 🍇`);

subagentFirlat("Test Agent");
