export function storefrontIconUrl(icon,name) {
  // Prefer exact upstream identifiers; only inspect names inside generic buckets.
  const key=String(icon||"").trim().toLowerCase();
  const title=String(name||"").toLowerCase();
  // A few supplier records have missing or non-standard icon identifiers.
  // Match only clear product identities; generic SMS products get a neutral phone glyph.
  if(!key && /tk账号|tiktok/.test(title)) return "https://play-lh.googleusercontent.com/2o7iuqPe-0msP3DvNhzoOgNo4eZ6GkL_RtGVeKyBn5UBQAW5cw-GW5V3wDOHB1yTQuqWzrFLFOv2u4_5ea1uhg=w240-h480";
  if(key==="shop-google-voice-logo") return "https://play-lh.googleusercontent.com/k2dlxKuS46VOCluBwZDz6iGnmslA-ImxlZPjgaAMJvpvmP6aQlrLuQY0hSWhZL49IB9WnqzfAZCE_yCjO7un1g=w240-h480";
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
    if(title.includes("proton mail") || title.includes("protonmail")) return "https://play-lh.googleusercontent.com/TrxNlz9xizn4GBiVB2gWyws0majvL7tuCS1OsoaZxK1Sbi-uWFd51vo7eO9ghIDR6jQkIRF47mHoudd73KHazmI=w240-h480";
    if(title.includes("aol")) return "https://play-lh.googleusercontent.com/9ghboJaPiCC2dqtdfhktYDwyl0xKYu22DN61hfX1kl3JsrWQ_5H9W-8YkXL9pt8-zaF_IqwtYJT8nqO1eivWEA=w240-h480";
    if(title.includes("gmx")) return "https://play-lh.googleusercontent.com/Jsup6nEx4CAAcBLKlPryyoYa9LLx0OOVxbesw7FP-mr4YrW1ZMS1wI86rrYFG_-ODarLjD1bZmULs3BMLuy1=w240-h480";
    return "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.7.2/svgs/regular/envelope.svg";
  }
  const upstreamIcons={
    "shop-google":"https://play-lh.googleusercontent.com/c6KD_8-GvnGRJA4lRQ4y5YnUa3-LOeYAS7ubw1jWyB9bmr6Kj6zzRvh2A5WBB-Vd3e6zhElmhDv07fCJx2Fc=w240-h480",
    "shop-microsoft":"https://play-lh.googleusercontent.com/cQ6W3fn_i56tK1PDQZlKvpuggupXR-kGyzwCtF1vYw-wK9FS3YDVUTnpfEvpbWXXuqH6aJ1JRD_t5bfAyCD4=w240-h480",
    "shop-apple":"https://cdn.jsdelivr.net/npm/simple-icons@15.15.0/icons/apple.svg",
    "shop-discord":"https://play-lh.googleusercontent.com/w2DdjDHGSj3DQElQQM0_J3PsNsALS-WD3CBeH0aXOYceR-F3aT02gFonhoFzz-Tc9ec8Dx9cLqh48-tzIFcP=w240-h480",
    "shop-telegram":"https://play-lh.googleusercontent.com/PyZ3akMGXPV0tKKirKNwfO--PSQW3FHR6rD_H9mAaukZ8LiHyYFuBLeU8UZ2ok6r5SP79-3prkfybWKh98AZAD0=w240-h480",
    "shop-whatsapp":"https://play-lh.googleusercontent.com/Gqxk4T0uZsDwFp07DE-508hkyvcNmgFuRwPiwTEfF7D7OzGv1FdHDzEyMxNsSBZLOJlGpe3ULvVM2RgrRAlBqA=w240-h480",
    "shop-instagram":"https://play-lh.googleusercontent.com/yHi59jmO_lVamcyJ1i3rM1_E8bAiAspShnGjjURq05ipQQSUksO3QVEsXTegRSqul038-4YNA7O644XAcx251Q=w240-h480",
    "shop-tiktok":"https://play-lh.googleusercontent.com/2o7iuqPe-0msP3DvNhzoOgNo4eZ6GkL_RtGVeKyBn5UBQAW5cw-GW5V3wDOHB1yTQuqWzrFLFOv2u4_5ea1uhg=w240-h480",
    "shop-facebook":"https://play-lh.googleusercontent.com/12KEJDhgk6oyE1VgmfCuFzFrQripZ_endElbvEhU1rZawQgV3RI-v3II8fDslI1sdC_WKBkmtxS3jxuIihk33Q=w240-h480",
    "shop-twitter-circle-fill":"https://play-lh.googleusercontent.com/IsLsCD4eLC2CYvlkgTI6Z5TROj0BJIBgUF7BZ5eliTzyyTjqG_mbofeG4kw2s7oG_JZMSi5ErLz_qsDi169C8w=w240-h480",
    "shop-steam":"https://play-lh.googleusercontent.com/E_x2GPSJakCdUYfECBptVyFoVnC4BxIPy3K4OdbwNyEtEJkRAY_J-Lo_Ltiybq6LiJ_aZCIzvqLv5h4Fbk91=w240-h480",
    "shop-yahoo":"https://play-lh.googleusercontent.com/qWWpxNSBSTXvDgbnAMpBQEI8QmWXuE8lEhFSxoeBCEoKedY2g2K8-3b0mgxC5M0Xos_BYNfzZJefdlc9q1eZbw=w240-h480",
    "shop-youtube":"https://play-lh.googleusercontent.com/QNmuZQc9I6Zbe3mWnSr0hycnENqGFCI5p3yE29Hkxtf22T0IWS6zTrpxULLyyjWpB7ONAXDsDQXnXcVWokl3eg=w240-h480",
    "shop-linkedin":"https://play-lh.googleusercontent.com/oij55bxj3e-4JrhGntpki0lnQyE8yQn8X5FPEzZ0t7cLppeiSINynEk7n9COoh7QSaCOZ_yiPO31NVaW4SDbWg=w240-h480",
    "shop-amazon-circle-fill":"https://play-lh.googleusercontent.com/UIYZ9hTFNg-zZUg_uzLS9YdyDpvoo1VHNFb6VlzHy5JqNMq9Uq-p2S1VPwzXCipHTFacfGKhJkyAuKL19VVlcWA=w240-h480",
    "shop-skype":"https://play-lh.googleusercontent.com/afnciqsoxrp8BYGFAS_BZtUBn2NvmxTVoKFproR5SljREfTBnueRjPxzxCXvIJNYTUdbtOWz-_GjVuOCMfi7fiU=w240-h480"
  };
  return upstreamIcons[key] || "";
}
