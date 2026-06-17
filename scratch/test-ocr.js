import { createWorker } from 'tesseract.js';

async function test() {
  const imagePath = 'C:\\Users\\hp\\.gemini\\antigravity-ide\\brain\\7438f1a7-0954-4645-9b4d-f737031771aa\\media__1781644458088.jpg';
  console.log('Testing OCR on:', imagePath);
  
  const worker = await createWorker('eng');
  
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,:;-_*()[]{} \n\r',
    tessedit_pageseg_mode: '3',
  });
  
  const ret = await worker.recognize(imagePath, {}, { text: true, tsv: true, blocks: true });
  console.log('=== TSV DATA (truncated) ===');
  if (ret.data.tsv) {
    console.log(ret.data.tsv.substring(0, 1000));
  } else {
    console.log('ret.data.tsv is STILL null');
  }
  console.log('======================');
  
  await worker.terminate();
}

test().catch(console.error);
