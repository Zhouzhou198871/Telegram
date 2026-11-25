export function storefrontIconUrl(icon,name) {
  // Prefer exact upstream identifiers; only inspect names inside generic buckets.
  const key=String(icon||"").trim().toLowerCase();
  const title=String(name||"").toLowerCase();
  // A few supplier records have missing or non-standard icon identifiers.
  // Match only clear product identities; generic SMS products get a neutral phone glyph.
  if(!key && /tk账号|tiktok/.test(title)) return "https://play-lh.googleusercontent.com/2o7iuqPe-0msP3DvNhzoOgNo4eZ6GkL_RtGVeKyBn5UBQAW5cw-GW5V3wDOHB1yTQuqWzrFLFOv2u4_5ea1uhg=w240-h480";
  if(key==="shop-google-voice-logo") return "https://ssl.gstatic.com/images/branding/productlogos/voice_2026/v2/ico/voice_2026_256dp.ico";
  if(key==="shop-textnow") return "https://play-lh.googleusercontent.com/dhPBaff_7shT1IF0fV0P1R0psaYknV9ppvu1IyNrj3f1uXET9F56C_7w5OvfT16nKdKIGJG8Q86QI0YsjU6tIA=w240-h480";
  if(key==="shop-sms") return "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/solid/mobile-screen-button.svg";
  // Supplier has one Gmail product filed under YouTube; the product identity wins over its category label.
  if(key==="shop-youtube" && /google.*gmail|gmail.*google/.test(title)) return "https://play-lh.googleusercontent.com/c6KD_8-GvnGRJA4lRQ4y5YnUa3-LOeYAS7ubw1jWyB9bmr6Kj6zzRvh2A5WBB-Vd3e6zhElmhDv07fCJx2Fc=w240-h480";
  if(key==="shop-instagram" && /threads/.test(title)) return "https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/threads.svg";
  if(key==="shop-other") {
    if(title.includes("ixbrowser")) return "https://d.ixbrowser.com/ixbrowser/image/logo/icon.png";
    if(title.includes("deezer")) return "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/brands/deezer.svg";
    if(title.includes("snapchat")) return "https://play-lh.googleusercontent.com/nOJWJoDAzuRSHmlFfpzHXAj8UbTJwk_JGYf0uAPTKPtiiIX_2Y7r5ATO1ZtxHRqaFTqfIDZ40PnBK4hukeJh=w240-h480";
    if(title.includes("tinder")) return "https://play-lh.googleusercontent.com/VaExVMyjnrd9PkIAKchSBK6Eo7zb4A2rriDbD3pUvmveAy46StPS-Hs5mYVIP9upZV4YCJxRoQRnj77FAaQd2A=w240-h480";
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
    "shop-telegram":"https://play-lh.googleusercontent.com/PyZ3akMGXPV0tKKirKNwfO--PSQW3FHR6rD_H9mAaukZ8LiHyYFuBLeU8UZ2ok6r5SP79-3prkfybWKh98AZAD0=w240-h480",
    "shop-whatsapp":"https://play-lh.googleusercontent.com/Gqxk4T0uZsDwFp07DE-508hkyvcNmgFuRwPiwTEfF7D7OzGv1FdHDzEyMxNsSBZLOJlGpe3ULvVM2RgrRAlBqA=w240-h480",
    "shop-instagram":"https://play-lh.googleusercontent.com/yHi59jmO_lVamcyJ1i3rM1_E8bAiAspShnGjjURq05ipQQSUksO3QVEsXTegRSqul038-4YNA7O644XAcx251Q=w240-h480",
    "shop-tiktok":"https://play-lh.googleusercontent.com/2o7iuqPe-0msP3DvNhzoOgNo4eZ6GkL_RtGVeKyBn5UBQAW5cw-GW5V3wDOHB1yTQuqWzrFLFOv2u4_5ea1uhg=w240-h480",
    "shop-facebook":"https://play-lh.googleusercontent.com/12KEJDhgk6oyE1VgmfCuFzFrQripZ_endElbvEhU1rZawQgV3RI-v3II8fDslI1sdC_WKBkmtxS3jxuIihk33Q=w240-h480",
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
