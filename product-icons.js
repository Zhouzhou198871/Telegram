export function storefrontIconUrl(icon,name) {
  // Prefer exact upstream identifiers; only inspect names inside generic buckets.
  const key=String(icon||"").trim().toLowerCase();
  const title=String(name||"").toLowerCase();
  // A few supplier records have missing or non-standard icon identifiers.
  // Match only clear product identities; generic SMS products get a neutral phone glyph.
  if(!key && /tk账号|tiktok/.test(title)) return "https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/tiktok.svg";
  if(key==="shop-google-voice-logo") return "https://ssl.gstatic.com/images/branding/productlogos/voice_2026/v2/ico/voice_2026_256dp.ico";
  if(key==="shop-textnow") return "https://iconsdb.app/api/v1/icon/app-icons/textnow-call-text-unlimited.png?size=512";
  if(key==="shop-sms") return "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/solid/mobile-screen-button.svg";
  // Supplier has one Gmail product filed under YouTube; the product identity wins over its category label.
  if(key==="shop-youtube" && /google|gmail/.test(title)) return "https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/google.svg";
  if(key==="shop-instagram" && /threads/.test(title)) return "https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/threads.svg";
  if(key==="shop-other") {
    if(title.includes("ixbrowser")) return "https://d.ixbrowser.com/ixbrowser/image/logo/icon.png";
    if(title.includes("deezer")) return "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/brands/deezer.svg";
    if(title.includes("snapchat")) return "https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/snapchat.svg";
    if(title.includes("reddit")) return "https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/reddit.svg";
    return "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/solid/box-open.svg";
  }
  if(key==="shop-mail") {
    if(title.includes("proton mail") || title.includes("protonmail")) return "https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/protonmail.svg";
    if(title.includes("aol")) return "https://www.aol.com/favicon.ico";
    if(title.includes("gmx")) return "https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/gmx.svg";
    return "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/regular/envelope.svg";
  }
  const upstreamIcons={
    "shop-google":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/google.svg",
    "shop-microsoft":"https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/brands/microsoft.svg",
    "shop-apple":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/apple.svg",
    "shop-discord":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/discord.svg",
    "shop-telegram":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/telegram.svg",
    "shop-whatsapp":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/whatsapp.svg",
    "shop-instagram":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/instagram.svg",
    "shop-tiktok":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/tiktok.svg",
    "shop-facebook":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/facebook.svg",
    "shop-twitter-circle-fill":"https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/brands/twitter.svg",
    "shop-steam":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/steam.svg",
    "shop-yahoo":"https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/brands/yahoo.svg",
    "shop-youtube":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/youtube.svg",
    "shop-linkedin":"https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/brands/linkedin.svg",
    "shop-amazon-circle-fill":"https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/brands/amazon.svg",
    "shop-skype":"https://teams.public.onecdn.static.microsoft/hashed/favicon/prod/favicon-f1722d9.ico"
  };
  return upstreamIcons[key] || "";
}
