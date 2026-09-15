/**
 * Sandbox demo menüsü — 22 ürün.
 * Menü küçük olduğu için TAMAMI realtime oturumunun instructions'ına gömülür;
 * fiyat/içerik sorularında fonksiyon çağrısı gerekmez (gecikme kazancı).
 */
export interface SandboxMenuSeedItem {
  name: string;
  description: string;
  price: number;
  category: string;
}

export const SANDBOX_MENU: SandboxMenuSeedItem[] = [
  // Pizzalar (5)
  { name: 'Margherita Pizza', description: 'Mozzarella, domates sosu, taze fesleğen', price: 180, category: 'Pizzalar' },
  { name: 'Sucuklu Pizza', description: 'Bol sucuk, mozzarella, domates sosu', price: 220, category: 'Pizzalar' },
  { name: 'Karisik Pizza', description: 'Sucuk, salam, mantar, biber, zeytin', price: 240, category: 'Pizzalar' },
  { name: 'Ton Balikli Pizza', description: 'Ton baligi, misir, sogan, mozzarella', price: 250, category: 'Pizzalar' },
  { name: 'Dort Peynirli Pizza', description: 'Mozzarella, cheddar, parmesan, rokfor', price: 260, category: 'Pizzalar' },
  // Burgerler (4)
  { name: 'Klasik Hamburger', description: '150 gr dana kofte, marul, domates, turşu', price: 190, category: 'Burgerler' },
  { name: 'Cheeseburger', description: '150 gr dana kofte, cheddar, marul, domates', price: 210, category: 'Burgerler' },
  { name: 'Tavuk Burger', description: 'Cıtır tavuk gogsu, marul, ranch sos', price: 195, category: 'Burgerler' },
  { name: 'Duble Burger', description: '2 x 150 gr dana kofte, cift cheddar', price: 280, category: 'Burgerler' },
  // Makarnalar (3)
  { name: 'Napolitan Makarna', description: 'Domates soslu penne, fesleğen, parmesan', price: 160, category: 'Makarnalar' },
  { name: 'Alfredo Makarna', description: 'Kremali fettuccine, tavuk, mantar', price: 185, category: 'Makarnalar' },
  { name: 'Arabiata Makarna', description: 'Acili domates soslu penne, sarımsak', price: 175, category: 'Makarnalar' },
  // Salatalar (3)
  { name: 'Sezar Salata', description: 'Marul, tavuk, kruton, parmesan, sezar sos', price: 150, category: 'Salatalar' },
  { name: 'Akdeniz Salata', description: 'Domates, salatalik, zeytin, beyaz peynir', price: 140, category: 'Salatalar' },
  { name: 'Ton Balikli Salata', description: 'Ton baligi, misir, marul, limon sos', price: 165, category: 'Salatalar' },
  // Tatlilar (3)
  { name: 'Tiramisu', description: 'Mascarpone, kahve, kakao', price: 120, category: 'Tatlilar' },
  { name: 'Sufle', description: 'Sicak cikolatali sufle, vanilyali dondurma', price: 130, category: 'Tatlilar' },
  { name: 'Cheesecake', description: 'Frambuazli New York usulu cheesecake', price: 125, category: 'Tatlilar' },
  // Icecekler (4)
  { name: 'Kola', description: '330 ml kutu', price: 45, category: 'Icecekler' },
  { name: 'Ayran', description: '300 ml', price: 30, category: 'Icecekler' },
  { name: 'Su', description: '500 ml', price: 15, category: 'Icecekler' },
  { name: 'Limonata', description: 'Ev yapımı, 400 ml', price: 55, category: 'Icecekler' },
];
