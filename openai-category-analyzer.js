const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const CATEGORIES = [
  // ✅ Tesettür
  "tesettür", "ferace", "şal", "bone",

  // ✅ Üst Giyim
  "tunik", "gömlek", "bluz", "kazak", "hırka",
  "sweatshirt", "tişört", "crop", "ceket", "takım",

  // ✅ Alt Giyim
  "etek", "pantolon", "şort", "jean",

  // ✅ Elbise
  "elbise",

  // ✅ İç & Plaj Giyim
  "iç giyim", "bikini", "mayokini",

  // ✅ Dış Giyim
  "trençkot", "kaban", "mont", "yağmurluk", "dış giyim",

  // ✅ Ayakkabı
  "ayakkabı", "topuklu ayakkabı", "spor ayakkabı", "bot",

  // ✅ Aksesuar
  "çanta", "şapka", "gözlük", "takı", "aksesuar",

  // ✅ Diğer
  "diğer"
]

async function classifyCaption(caption) {
  const prompt = `
Aşağıda bir Instagram post açıklaması verilmiştir. Lütfen bu açıklamaya en uygun tek bir kategoriyi yalnızca aşağıdaki listeden seç:

${CATEGORIES.join(', ')}

Açıklama:
"""${caption}"""

Yalnızca tek bir kategori ismi döndür:
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Kısa ve net sınıflandırma yapacak bir moda analiz asistanısın.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    });

    const result = response.choices?.[0]?.message?.content?.trim()?.toLowerCase() || 'diğer';
    return CATEGORIES.includes(result) ? result : 'diğer';
  } catch (err) {
    console.error('🛑 Caption sınıflandırma hatası:', err.message);
    return 'diğer';
  }
}

module.exports = { classifyCaption };
