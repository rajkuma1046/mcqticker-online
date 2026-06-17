import { createWorker } from 'tesseract.js';

// Heuristic mapper for common OCR misreads of option letters
const mapOcrCharToOption = (char) => {
  const c = char.toLowerCase();
  if (['a', '2', '4', '@', 'e'].includes(c)) return 'A';
  if (['b', '6', '8', 'h'].includes(c)) return 'B';
  if (['c', '0', 'o', '¢'].includes(c)) return 'C';
  if (['d'].includes(c)) return 'D';
  return null;
};

// Heuristic for extracting option letter from a word string
const extractOption = (wordText) => {
  const clean = wordText.trim().toLowerCase();
  
  // Match option in parenthesis: (c), (o), [b], {a} etc.
  const parenMatch = /[\(\[\{]([a-fA-F0-9oO\@\¢])[\)\]\}]/.exec(clean);
  if (parenMatch) return mapOcrCharToOption(parenMatch[1]);
  
  // Match option after a separator: 12.a, 12.(a, 12-b etc.
  const dotMatch = /[\.\,\;\-\:\_\*)]+([a-fA-F0-9oO\@\¢])/.exec(clean);
  if (dotMatch) return mapOcrCharToOption(dotMatch[1]);

  // Match number followed immediately by option: 12a, 3c, 24d
  const numOptMatch = /\d+([a-fA-F0-9oO\@\¢])\b/.exec(clean);
  if (numOptMatch) return mapOcrCharToOption(numOptMatch[1]);

  // If the word is just a single character option
  if (/^[a-fA-F0-9oO\@\¢]$/.test(clean)) {
    return mapOcrCharToOption(clean);
  }

  // Check if ends with option character after a parenthesis
  const endMatch = /([a-fA-F0-9oO\@\¢])\)?$/.exec(clean);
  if (endMatch) return mapOcrCharToOption(endMatch[1]);

  return null;
};

async function test() {
  const imagePath = 'C:\\Users\\hp\\.gemini\\antigravity-ide\\brain\\7438f1a7-0954-4645-9b4d-f737031771aa\\media__1781644458088.jpg';
  console.log('Testing Grid Parser on:', imagePath);
  
  const worker = await createWorker('eng');
  
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,:;-_*()[]{} \n\r',
    tessedit_pageseg_mode: '11',
  });
  
  const ret = await worker.recognize(imagePath, {}, { text: true, tsv: true });
  
  const gridKeys = {};
  const lines = ret.data.tsv.split('\n');
  const words = [];

  // Parse TSV lines
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 12) {
      const level = parts[0];
      if (level !== '5') continue;

      const conf = parseFloat(parts[10]);
      const wordText = parts[11].trim();
      const left = parseInt(parts[6], 10);
      const top = parseInt(parts[7], 10);
      const width = parseInt(parts[8], 10);
      const height = parseInt(parts[9], 10);

      if (wordText && conf > 30) {
        words.push({ text: wordText, left, top, width, height, conf });
      }
    }
  }

  console.log(`Parsed ${words.length} words from TSV.`);

  if (words.length > 0) {
    // Find bounding box of answer-like blocks to isolate active grid area
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let foundAnswerLike = false;

    const isAnswerLike = (wText) => {
      const t = wText.trim().toLowerCase();
      const isNum = /^\d+[\s\.\,\;\-\:\_\*)]*$/.test(t);
      const isOpt = extractOption(t) !== null;
      return isNum || isOpt;
    };

    // Filter to only include words that are likely in the "ANSWER KEY" table
    // Let's print out what is found and where they are
    for (const w of words) {
      // In the full page, the table starts with Q1-30. The Y coordinates of the table are in a narrow band.
      // Let's filter to words that contain a question number or option AND are in the bottom region of the image
      // (table is in the lower half of the page).
      // Let's check: the table is in the lower half, meaning top > 350.
      if (isAnswerLike(w.text) && w.top > 350) {
        minX = Math.min(minX, w.left);
        minY = Math.min(minY, w.top);
        maxX = Math.max(maxX, w.left + w.width);
        maxY = Math.max(maxY, w.top + w.height);
        foundAnswerLike = true;
      }
    }

    console.log(`Table bounds: minX=${minX}, minY=${minY}, maxX=${maxX}, maxY=${maxY}`);

    const tableW = maxX - minX;
    const tableH = maxY - minY;

    if (tableW > 0 && tableH > 0) {
      const gridCells = {};

      for (const w of words) {
        // Only map words that fall inside the table region
        if (w.left >= minX && w.left + w.width <= maxX && w.top >= minY && w.top + w.height <= maxY) {
          const cx = w.left + w.width / 2;
          const cy = w.top + w.height / 2;

          let col = Math.floor(((cx - minX) / tableW) * 10);
          let row = Math.floor(((cy - minY) / tableH) * 3);

          if (col < 0) col = 0;
          if (col > 9) col = 9;
          if (row < 0) row = 0;
          if (row > 2) row = 2;

          const key = `${row},${col}`;
          if (!gridCells[key]) {
            gridCells[key] = [];
          }
          gridCells[key].push(w);
        }
      }

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 10; col++) {
          const cellWords = gridCells[`${row},${col}`] || [];
          const qNo = row * 10 + col + 1;

          let bestOption = null;
          let highestConf = -1;

          for (const w of cellWords) {
            const opt = extractOption(w.text);
            if (opt) {
              if (w.conf > highestConf) {
                highestConf = w.conf;
                bestOption = opt;
              }
            }
          }

          if (bestOption) {
            gridKeys[qNo] = bestOption;
          }
        }
      }
    }
  }

  console.log('=== GRID PARSED KEYS ===');
  console.log(gridKeys);
  console.log('Total keys parsed:', Object.keys(gridKeys).length);

  await worker.terminate();
}

test().catch(console.error);
