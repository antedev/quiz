const res = await fetch('http://127.0.0.1:5173/');
console.log('Server status:', res.status);
const text = await res.text();
console.log('Response title exists:', text.includes('<title>'));
const dataRes = await fetch('http://127.0.0.1:5173/data/people.json');
console.log('people.json status:', dataRes.status, 'size:', (await dataRes.text()).length);
