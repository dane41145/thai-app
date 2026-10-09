// The 44 Thai consonants with their class (HC/MC/LC). Shared by the
// flashcards page (Letters mode) and the /classes game.
//
// `say` is what we send to TTS. Azure reads a bare consonant unpredictably
// (ก ไก่ came out as just "กอ", ฉ ฉิ่ง as "ชิง", ซ as "สาม"), so each name is
// spelled as spoken: the consonant + อ. That also carries the right tone —
// High-class names rise (ขอ), Mid and Low stay level (กอ, คอ). Rare letters
// borrow a common letter with the same sound and class (ฃ→ขอ, ศ/ษ→สอ, ฐ→ถอ,
// ฑ/ฒ→ทอ, ณ→นอ, ภ→พอ, ฬ→ลอ, ฌ→ชอ, ญ→ยอ), and words the voice misreads are
// respelled too (ชฎา→ชะดา, ปฏัก→ปะตัก, มณโฑ→มนโท, เณร→เนน, ฤๅษี→รือสี,
// ยักษ์→ยัก). Checked by synthesising each one and transcribing it back.
const THAI_LETTERS = [
    { letter: "ก", fullName: "ก ไก่", say: "กอ ไก่", letterClass: "MC", meaning: "chicken", emoji: "🐔" },
    { letter: "ข", fullName: "ข ไข่", say: "ขอ ไข่", letterClass: "HC", meaning: "egg", emoji: "🥚" },
    { letter: "ฃ", fullName: "ฃ ขวด", say: "ขอ ขวด", letterClass: "HC", meaning: "bottle (obsolete)", emoji: "🍾" },
    { letter: "ค", fullName: "ค ควาย", say: "คอ ควาย", letterClass: "LC", meaning: "buffalo", emoji: "🐃" },
    { letter: "ฅ", fullName: "ฅ คน", say: "คอ คน", letterClass: "LC", meaning: "person (obsolete)", emoji: "🧍" },
    { letter: "ฆ", fullName: "ฆ ระฆัง", say: "คอ ระฆัง", letterClass: "LC", meaning: "bell", emoji: "🔔" },
    { letter: "ง", fullName: "ง งู", say: "งอ งู", letterClass: "LC", meaning: "snake", emoji: "🐍" },
    { letter: "จ", fullName: "จ จาน", say: "จอ จาน", letterClass: "MC", meaning: "plate", emoji: "🍽️" },
    { letter: "ฉ", fullName: "ฉ ฉิ่ง", say: "ฉอ ฉิ่ง", letterClass: "HC", meaning: "cymbals", emoji: "🥁" },
    { letter: "ช", fullName: "ช ช้าง", say: "ชอ ช้าง", letterClass: "LC", meaning: "elephant", emoji: "🐘" },
    { letter: "ซ", fullName: "ซ โซ่", say: "ซอ โซ่", letterClass: "LC", meaning: "chain", emoji: "⛓️" },
    { letter: "ฌ", fullName: "ฌ เฌอ", say: "ชอ เชอ", letterClass: "LC", meaning: "tree", emoji: "🌳" },
    { letter: "ญ", fullName: "ญ หญิง", say: "ยอ หญิง", letterClass: "LC", meaning: "woman", emoji: "👩" },
    { letter: "ฎ", fullName: "ฎ ชฎา", say: "ดอ ชะดา", letterClass: "MC", meaning: "Thai headdress", emoji: "👑" },
    { letter: "ฏ", fullName: "ฏ ปฏัก", say: "ตอ ปะตัก", letterClass: "MC", meaning: "spear", emoji: "🔱" },
    { letter: "ฐ", fullName: "ฐ ฐาน", say: "ถอ ฐาน", letterClass: "HC", meaning: "base / pedestal", emoji: "🏛️" },
    { letter: "ฑ", fullName: "ฑ มณโฑ", say: "ทอ มนโท", letterClass: "LC", meaning: "Montho (character)", emoji: "👸" },
    { letter: "ฒ", fullName: "ฒ ผู้เฒ่า", say: "ทอ ผู้เฒ่า", letterClass: "LC", meaning: "old man", emoji: "👴" },
    { letter: "ณ", fullName: "ณ เณร", say: "นอ เนน", letterClass: "LC", meaning: "novice monk", emoji: "🧘" },
    { letter: "ด", fullName: "ด เด็ก", say: "ดอ เด็ก", letterClass: "MC", meaning: "child", emoji: "👦" },
    { letter: "ต", fullName: "ต เต่า", say: "ตอ เต่า", letterClass: "MC", meaning: "turtle", emoji: "🐢" },
    { letter: "ถ", fullName: "ถ ถุง", say: "ถอ ถุง", letterClass: "HC", meaning: "bag / sack", emoji: "🛍️" },
    { letter: "ท", fullName: "ท ทหาร", say: "ทอ ทหาร", letterClass: "LC", meaning: "soldier", emoji: "💂" },
    { letter: "ธ", fullName: "ธ ธง", say: "ทอ ธง", letterClass: "LC", meaning: "flag", emoji: "🚩" },
    { letter: "น", fullName: "น หนู", say: "นอ หนู", letterClass: "LC", meaning: "mouse / rat", emoji: "🐭" },
    { letter: "บ", fullName: "บ ใบไม้", say: "บอ ใบไม้", letterClass: "MC", meaning: "leaf", emoji: "🍃" },
    { letter: "ป", fullName: "ป ปลา", say: "ปอ ปลา", letterClass: "MC", meaning: "fish", emoji: "🐟" },
    { letter: "ผ", fullName: "ผ ผึ้ง", say: "ผอ ผึ้ง", letterClass: "HC", meaning: "bee", emoji: "🐝" },
    { letter: "ฝ", fullName: "ฝ ฝา", say: "ฝอ ฝา", letterClass: "HC", meaning: "lid / cover", emoji: "🫙" },
    { letter: "พ", fullName: "พ พาน", say: "พอ พาน", letterClass: "LC", meaning: "tray", emoji: "🏆" },
    { letter: "ฟ", fullName: "ฟ ฟัน", say: "ฟอ ฟัน", letterClass: "LC", meaning: "teeth", emoji: "🦷" },
    { letter: "ภ", fullName: "ภ สำเภา", say: "พอ สำเภา", letterClass: "LC", meaning: "junk (sailing ship)", emoji: "⛵" },
    { letter: "ม", fullName: "ม ม้า", say: "มอ ม้า", letterClass: "LC", meaning: "horse", emoji: "🐴" },
    { letter: "ย", fullName: "ย ยักษ์", say: "ยอ ยัก", letterClass: "LC", meaning: "giant / ogre", emoji: "👹" },
    { letter: "ร", fullName: "ร เรือ", say: "รอ เรือ", letterClass: "LC", meaning: "boat", emoji: "🚣" },
    { letter: "ล", fullName: "ล ลิง", say: "ลอ ลิง", letterClass: "LC", meaning: "monkey", emoji: "🐒" },
    { letter: "ว", fullName: "ว แหวน", say: "วอ แหวน", letterClass: "LC", meaning: "ring", emoji: "💍" },
    { letter: "ศ", fullName: "ศ ศาลา", say: "สอ ศาลา", letterClass: "HC", meaning: "pavilion", emoji: "🛖" },
    { letter: "ษ", fullName: "ษ ฤๅษี", say: "สอ รือสี", letterClass: "HC", meaning: "hermit", emoji: "🧙" },
    { letter: "ส", fullName: "ส เสือ", say: "สอ เสือ", letterClass: "HC", meaning: "tiger", emoji: "🐯" },
    { letter: "ห", fullName: "ห หีบ", say: "หอ หีบ", letterClass: "HC", meaning: "chest / box", emoji: "🧰" },
    { letter: "ฬ", fullName: "ฬ จุฬา", say: "ลอ จุฬา", letterClass: "LC", meaning: "kite", emoji: "🪁" },
    { letter: "อ", fullName: "อ อ่าง", say: "ออ อ่าง", letterClass: "MC", meaning: "basin / tub", emoji: "🛁" },
    { letter: "ฮ", fullName: "ฮ นกฮูก", say: "ฮอ นกฮูก", letterClass: "LC", meaning: "owl", emoji: "🦉" }
];
