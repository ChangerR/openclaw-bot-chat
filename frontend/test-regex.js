const tests = [
  "@",
  " @",
  "你好@",
  "test@",
  "email@domain.com",
  "@bot",
  "hello @bot",
  "你好@bot",
  "test @bot"
];

const regex = /(?:^|[\s\n\u4e00-\u9fa5])([@＠][^\s\n]*)$/;
const newRegex = /(?:^|[^a-zA-Z0-9_])([@＠][^\s\n]*)$/;

console.log("OLD REGEX:");
for (const t of tests) {
  const match = t.match(regex);
  console.log(`"${t}" -> ${match ? match[1] : 'null'}`);
}

console.log("\nNEW REGEX:");
for (const t of tests) {
  const match = t.match(newRegex);
  console.log(`"${t}" -> ${match ? match[1] : 'null'}`);
}
