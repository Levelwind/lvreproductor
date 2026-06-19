import { useState, useEffect } from 'react';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function useColorExtractor(imageUrl: string | undefined) {
  const [dominantColor, setDominantColor] = useState<string>('rgba(24, 24, 27, 1)');
  const [gradientColors, setGradientColors] = useState<[string, string]>(['rgba(24,24,27,1)', 'rgba(9,9,11,1)']);
  const [vibrantColor, setVibrantColor] = useState<string>('rgb(255, 85, 0)');
  const [isLightBackground, setIsLightBackground] = useState<boolean>(false);
  const [isVeryDarkBackground, setIsVeryDarkBackground] = useState<boolean>(true);
  const [contrastColor, setContrastColor] = useState<string>('rgb(255, 85, 0)');
  const [secondaryContrastColor, setSecondaryContrastColor] = useState<string>('rgba(255, 255, 255, 0.6)');
  const [textColor, setTextColor] = useState<string>('#ffffff');
  const [playButtonBg, setPlayButtonBg] = useState<string>('#ffffff');
  const [playButtonText, setPlayButtonText] = useState<string>('#000000');

  useEffect(() => {
    if (!imageUrl) {
      setDominantColor('rgba(24, 24, 27, 1)');
      setGradientColors(['rgba(24,24,27,1)', 'rgba(9,9,11,1)']);
      setVibrantColor('rgb(255, 85, 0)');
      setIsLightBackground(false);
      setIsVeryDarkBackground(true);
      setContrastColor('#ff4500'); // Solid high-contrast red-orange for dark/black backgrounds
      setSecondaryContrastColor('rgba(255, 255, 255, 0.6)');
      setTextColor('#ffffff');
      setPlayButtonBg('#ffffff');
      setPlayButtonText('#000000');
      return;
    }

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = 64;
      canvas.height = 64;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      let totalR = 0, totalG = 0, totalB = 0;
      let totalCount = 0;

      let maxSat = -1;
      let bestR = 128, bestG = 128, bestB = 128;

      for (let i = 0; i < data.length; i += 16) {
        const rVal = data[i];
        const gVal = data[i + 1];
        const bVal = data[i + 2];

        totalR += rVal;
        totalG += gVal;
        totalB += bVal;
        totalCount++;

        const [, s, l] = rgbToHsl(rVal, gVal, bVal);

        // Filter out extreme colors (too dark, too bright, too gray)
        if (l > 12 && l < 88 && s > 15) {
          if (s > maxSat) {
            maxSat = s;
            bestR = rVal;
            bestG = gVal;
            bestB = bVal;
          }
        }
      }

      const avgR = Math.floor(totalR / totalCount);
      const avgG = Math.floor(totalG / totalCount);
      const avgB = Math.floor(totalB / totalCount);

      if (maxSat === -1) {
        bestR = avgR;
        bestG = avgG;
        bestB = avgB;
      }

      // Calculate perceived luminance of the average background color
      const luminance = (avgR * 299 + avgG * 587 + avgB * 114) / 1000;
      const isLight = luminance > 135; // slightly higher threshold to favor dark theme look
      const isVeryDark = !isLight && luminance < 30; // almost black/very dark background

      const [hBest, sBest, lBest] = rgbToHsl(bestR, bestG, bestB);

      let contrast;
      let secondaryContrast;
      let text;
      let pbBg;
      let pbText;

      if (isLight) {
        // Light background -> Dark contrast colors
        const targetL = Math.max(18, Math.min(30, lBest - 25));
        contrast = `hsl(${hBest}, ${Math.max(65, sBest)}%, ${targetL}%)`;
        secondaryContrast = `rgba(0, 0, 0, 0.6)`;
        text = '#0a0a0c';
        pbBg = '#0a0a0c';
        pbText = '#ffffff';
      } else if (isVeryDark) {
        // Very dark / black background -> Solid high-contrast red-orange
        contrast = '#ff4500';
        secondaryContrast = `rgba(255, 255, 255, 0.65)`;
        text = '#ffffff';
        pbBg = '#ffffff';
        pbText = '#0a0a0c';
      } else {
        // Dark background -> Light contrast colors
        const targetL = Math.max(70, Math.min(85, lBest + 20));
        contrast = `hsl(${hBest}, ${Math.max(75, sBest)}%, ${targetL}%)`;
        secondaryContrast = `rgba(255, 255, 255, 0.65)`;
        text = '#ffffff';
        pbBg = '#ffffff';
        pbText = '#0a0a0c';
      }

      const brighten = (val: number) => Math.min(255, Math.floor(val * 1.25));
      const rgbBright = `rgb(${brighten(avgR)}, ${brighten(avgG)}, ${brighten(avgB)})`;
      const darkRgb = `rgb(${Math.floor(avgR * 0.35)}, ${Math.floor(avgG * 0.35)}, ${Math.floor(avgB * 0.35)})`;

      setDominantColor(`rgb(${avgR}, ${avgG}, ${avgB})`);
      setGradientColors([rgbBright, darkRgb]);
      setVibrantColor(`hsl(${hBest}, ${sBest}%, ${lBest}%)`);
      setIsLightBackground(isLight);
      setIsVeryDarkBackground(isVeryDark);
      setContrastColor(contrast);
      setSecondaryContrastColor(secondaryContrast);
      setTextColor(text);
      setPlayButtonBg(pbBg);
      setPlayButtonText(pbText);
    };

    img.onerror = () => {
      setDominantColor('rgba(24, 24, 27, 1)');
      setGradientColors(['rgba(24,24,27,1)', 'rgba(9,9,11,1)']);
      setVibrantColor('rgb(255, 85, 0)');
      setIsLightBackground(false);
      setIsVeryDarkBackground(true);
      setContrastColor('#ff4500'); // Solid high-contrast red-orange
      setSecondaryContrastColor('rgba(255, 255, 255, 0.6)');
      setTextColor('#ffffff');
      setPlayButtonBg('#ffffff');
      setPlayButtonText('#000000');
    };
  }, [imageUrl]);

  return { 
    dominantColor, 
    gradientColors, 
    vibrantColor, 
    isLightBackground, 
    isVeryDarkBackground,
    contrastColor, 
    secondaryContrastColor, 
    textColor, 
    playButtonBg, 
    playButtonText 
  };
}
