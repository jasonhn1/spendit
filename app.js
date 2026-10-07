if(window.top!==window.self){document.documentElement.innerHTML='';throw new Error('Spend It can’t run inside another site.')}
// ==== CORE (shared with page) ====
const MONEY=/(-\s*)?\(?\$?\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\)?/;
function num(s){return parseFloat(String(s).replace(/[$,\s]/g,''))}
function findPeriod(text){
  let m=text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|–|to|through)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if(m) return {start:toISO(m[1]),end:toISO(m[2])};
  m=text.match(/([A-Z][a-z]+ \d{1,2}, \d{4})\s*(?:-|–|to|through)\s*([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if(m){const a=new Date(m[1]),b=new Date(m[2]);if(!isNaN(a)&&!isNaN(b))return {start:iso(a),end:iso(b)}}
  m=text.match(/(?:closing|statement) date:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if(m){const e=toISO(m[1]);const d=new Date(e+'T00:00:00');d.setDate(d.getDate()-31);return {start:iso(d),end:e}}
  return null;
}
function iso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function toISO(s){const [mm,dd,yy]=s.split('/');let y=+yy;if(y<100)y+=2000;return y+'-'+mm.padStart(2,'0')+'-'+dd.padStart(2,'0')}
function mdToISO(md,period){
  const p=md.split('/');if(p.length===3)return toISO(md);
  const mm=+p[0],dd=+p[1];
  if(!period){const y=new Date().getFullYear();return y+'-'+String(mm).padStart(2,'0')+'-'+String(dd).padStart(2,'0')}
  const ey=+period.end.slice(0,4),em=+period.end.slice(5,7);
  const y=mm>em+1?ey-1:ey; // e.g. Dec txn on Jan statement
  return y+'-'+String(mm).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
}
function findSummary(text){
  const g=(re)=>{const m=text.match(re);return m?num(m[1]):null};
  return {
    purchases:g(/\bPurchases\s*\+?\s*\$\s?([\d,]+\.\d{2})/i),
    payments:g(/\bPayments\s*-\s*\$\s?([\d,]+\.\d{2})/i),
    credits:g(/\bCredits\s*-\s*\$\s?([\d,]+\.\d{2})/i),
    fees:g(/\bFees\s*\+\s*\$\s?([\d,]+\.\d{2})/i),
    interest:g(/\bInterest\s*\+\s*\$\s?([\d,]+\.\d{2})/i),
    cashAdvances:g(/\bCash advances\s*\+\s*\$\s?([\d,]+\.\d{2})/i),
    deposits:g(/(?:total )?deposits(?: and (?:other )?(?:additions|credits))?\s*\+?\s*\$?\s?([\d,]+\.\d{2})/i),
    withdrawals:g(/(?:total )?withdrawals(?: and (?:other )?(?:subtractions|debits))?\s*-?\s*\$?\s?([\d,]+\.\d{2})/i),
  };
}
function reportedTotals(r){
  if(!r)return null;
  const s=(...k)=>{let t=0,any=false;for(const x of k){if(r[x]!=null){t+=r[x];any=true}}return any?Math.round(t*100)/100:null};
  const out=r.withdrawals!=null?r.withdrawals:s('purchases','fees','interest','cashAdvances');
  const inn=r.deposits!=null?r.deposits:s('payments','credits');
  return {out,in:inn};
}
const DATE_START=/^(?:\d{5,}\s+)?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(?:(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+)?(.*)$/;
function heuristicParse(lines,period){
  const out=[];let section=0; // +1 charges, -1 credits
  let pending=null,prev='';
  for(let raw of lines){
    const L=raw.trim(),N=L.toLowerCase().replace(/\s+/g,'');
    if(!/\$\d/.test(L)){
      if(/^(payments?,?credits|paymentsand(other)?credits|deposits|credits|payments|otheradditions|additions)/.test(N))section=-1;
      else if(/^(standardpurchases|purchases|withdrawals|debits|feescharged|interestcharged|checkspaid|othersubtractions|subtractions|atm&debit|electronicwithdrawals)/.test(N))section=1;
    }
    const m=L.match(DATE_START);
    if(m){
      let rest=m[3];const am=rest.match(MONEY);
      if(am){
        const desc=rest.slice(0,am.index).replace(/\s+-\s*$/,'').trim();
        let a=num(am[2]+'.'+am[3]);
        const neg=!!am[1]||/^\(/.test(am[0])||section===-1||/payment.*thank|autopay|refund/i.test(desc);
        if(!desc&&pending){out.push({...pending,a:neg?-a:a});pending=null;prev=L;continue}
        if(!desc){if(prev&&!DATE_START.test(prev)&&!/\$\d/.test(prev))out.push({d:mdToISO(m[1],period),raw:prev,a:neg?-a:a});prev=L;continue}
        out.push({d:mdToISO(m[1],period),raw:desc,a:neg?-a:a});pending=null;
      } else if(rest.trim()) pending={d:mdToISO(m[1],period),raw:rest.trim()};
    } else if(pending){
      const am=L.match(/\$\s?([\d,]+)\.(\d{2})\s*$/);
      if(am){out.push({...pending,a:num(am[1]+'.'+am[2])*(section===-1||/-\s*\$[\d,]+\.\d\d\s*$/.test(L)?-1:1)});pending=null}
    }
    prev=L;
  }
  return out;
}

// ================= Taxonomy =================
const GROUPS=[
  {id:'food',name:'Food & Drink',c:'--s1',cats:['Restaurants','Fast Food','Food Delivery','Coffee, Tea & Drinks','Desserts & Bakery','Groceries']},
  {id:'shop',name:'Shopping',c:'--s2',cats:['Shopping','Clothing','Electronics','Home & Garden','Gifts']},
  {id:'auto',name:'Transportation',c:'--s3',cats:['Rideshare & Taxi','Parking & Tolls','Public Transit','Auto & Maintenance']},
  {id:'travel',name:'Travel',c:'--s4',cats:['Flights','Lodging','Travel & Vacation']},
  {id:'fun',name:'Entertainment',c:'--s5',cats:['Events & Tickets','Entertainment','Hobbies']},
  {id:'gas',name:'Gas',c:'--s6',cats:['Gas & EV Charging']},
  {id:'other',name:'Bills & Other',c:'--s7',cats:['Rent & Housing','Utilities','Phone & Internet','Subscriptions','Insurance','Fees & Interest','Pharmacy & Health','Personal Care','Fitness','Education','Charity & Giving','Smoke & Vape','Transfers to People','Cash & ATM','Other']},
  {id:'alcohol',name:'Alcohol',c:'--s8',cats:['Bars & Nightlife','Liquor & Wine']},
];
const SPECIAL=['Income','Transfers & Payments'];
const LIQ=/liquor|wine|spirits|bevmo|beverages & more|total wine|bottle shop|package store/i;
const FAST=/mcdonald|taco bell|\bkfc\b|carl'?s jr|in-n-out|raising cane|jack ?in ?the ?box|jackinthe|wendy|burger king|chick-fil-a|popeyes|panda express|subway|chipotle|five guys|del taco|el ?pollo ?loco|wingstop|jollibee|sonic drive|dairy queen|arby|habit burger|shake shack|panera|domino|pizza hut|little caesars|papa john|carls jr|smashburger|wienerschnitzel|taco bell|whataburger|white castle|culver|zaxby|qdoba|el pollo/i;
const DESSERT=/donut|doughnut|bakery|dessert|ice cream|pinkberry|yogurt|crepe|creamery|cookie|cake|mochi|churro|gelato|pastry|patisserie|boulangerie|85c|paris baguette/i;
const GROC=/trader joe|costco(?!\s*gas)|walgreens|\bcvs\b|\btarget\b|wal-?mart/i;
const NIGHT=/1015 folsom|harper ?& ?rye|monroe sf|temple nightclub|raven bar|bar darling|faces nightclub|beach club encore|encore beach club|\bzouk\b|lift bar|\bomnia\b|hakkasan|\bxs\b|marquee|\btao\b|drai'?s|wet republic|great northern|public works|halcyon|the endup|audio sf|sports page bar|rock bar|nightclub|night club|cocktail|speakeasy|taproom|brewery|brewing|tavern|saloon|\bpub\b|beer garden|wine bar|dive bar|\bbar\b|\blounge\b/i;
const NOT_NIGHT=/juice bar|smoothie|ramen bar|noodle bar|sushi bar|oyster bar|salad bar|restaurant & bar|restaurant and bar|bar & gri|rstbar|cinemark|run club|tea lounge|hong kong lounge|coffee bar|espresso bar|nail bar|brow bar|boba|milk tea/i;
const isNight=s=>NIGHT.test(s)&&!NOT_NIGHT.test(s);
const KNOWN=[
 [/tripla co|jitugyunkwang|ginza hotel|hilton(?!.*lounge)/i,'Lodging'],
 [/bill graham civic|fevo.*coachella|tixr|dice\.fm|sf singles wine|axs\.com|seetickets?|sierra tickets|nob hill masonic|bill graham amphi/i,'Events & Tickets'],
 [/jagalchi|koi palace|yard house|creasian fusion|ichiran|common sage|uogashiya|turtle tower|trattoria nakamura|ahmed ravi|flippers gourmet|hoi an|saigon 1|kitsune kyoto|delicious ?dim ?sum|laskatrina|las ?katrina|golden flower vietnamese|bun mee|poke express|chickies|prendi|zeffers|denny'?s|heirokuzushi|cjfreshway|nusa - ferry|intuit mtv/i,'Restaurants'],
 [/island water chart|maikoya|teamlab|kix tenants|shibuya scramble|monkey kart|kodaiji|jmsmide|jms\*mide|eiei seoul|yuhanhoisa|silvers kyoto|jeisangsa|koliamateu|\bmyu seoul|dear \d+seoul|the fountain \d+seoul|dancotoo|geullaim|me group japan/i,'Travel & Vacation'],
 [/olive young|cut and go|serviceworks/i,'Personal Care'],
 [/cardshop lotus/i,'Hobbies'],
 [/nordrack|nordstrom rack|g u co ltd|eibissimatcolia|mlbsungso|acme de la vie|yoshi'?s fashions|uniqlo/i,'Clothing'],
 [/empl+ei|donquijote|don quijote|marronniergate|mujirushi|barnes & noble/i,'Shopping'],
 [/whelans gift/i,'Gifts'],
 [/public activation|bungalowhuntington|the bungalow|westwood|svn west|space ?550|jaxson|the showdown|smugglers cove|the tap haus|the mint\(npu\)|audio and bella|vesuvio|cityscape loung|fairmont san francisco|faces llc|ukjingolbaingi/i,'Bars & Nightlife'],
 [/jeet big times|tobacco|hookah|smoke shop|vape|hollwood rock|hollywood rock/i,'Smoke & Vape'],
 [/groupon|fandango|16personali|subpar miniature|bing maloney|emeraldlakes|haggin oaks|golf/i,'Entertainment'],
 [/tithe\.ly/i,'Charity & Giving'],
 [/pacific pipe/i,'Fitness'],
 [/vioc|valvoline|\baaa\b/i,'Auto & Maintenance'],
 [/silicon valley valer|valero|7-eleven 38245/i,'Gas & EV Charging'],
 [/clipper|mobile suica|sfmta transit/i,'Public Transit'],
 [/neighbor\.com|neighbor:/i,'Rent & Housing'],
 [/seven-eleven|7-?eleven|familymart|lawson|gs25|ssiyu|daily ?yamazaki|deiriyamazaki|sundrug|cal mini mart|savemart|save mart|foodsco|far west fungi|harmony fresh/i,'Groceries'],
 [/michaelis wine/i,'Liquor & Wine'],
 [/golden crema|sanmarukukafue|pronto tokyo|maegaemzissikeopi|polkcha|pekoe|better buzz|bluestone lane/i,'Coffee, Tea & Drinks'],
 [/b\.?patisserie|baskin|crumbl|paribakeddeu|palibakeddeu|paris baguette|joesitalianice|joe'?s italian ice|funawa|krispy kreme|catalina cones|loving cup|dandelion chocolat/i,'Desserts & Bakery'],
 [/churchs chicken|church'?s chicken|halal guys|habit tejon|habit burger|slider buns|wetzel/i,'Fast Food'],
];
const NAMES=[[/axs\.com.*festival/i,'Festival tickets (AXS)'],[/bill graham civic/i,'Bill Graham Civic Auditorium'],[/bill graham amphi/i,'Bill Graham Civic concessions'],[/nob hill masonic/i,'Nob Hill Masonic Center'],
 [/fevo.*coachella/i,'Coachella'],[/tixr.*ebc/i,'Encore Beach Club tickets'],[/dice\.fm/i,'DICE'],[/intuit mtv/i,'Intuit café'],[/nobhill pizza/i,'Nob Hill Pizza & Shawarma'],[/tithe\.ly/i,'Tithe.ly (church giving)'],
 [/living church/i,'The Living Church'],[/jal airline/i,'Japan Airlines'],[/tripla/i,'Tripla (hotel booking)'],[/air premia/i,'Air Premia'],[/1015 folsom/i,'1015 Folsom'],[/harper ?& ?rye/i,'Harper & Rye'],
 [/raven bar/i,'Raven Bar'],[/monroe sf/i,'Monroe'],[/temple nightclub/i,'Temple Nightclub'],[/beach club encore/i,'Encore Beach Club'],[/polk & clay liquor/i,'Polk & Clay Liquor'],[/beverages & more/i,'BevMo'],
 [/bob'?s donuts/i,"Bob's Donuts"],[/teamlab/i,'teamLab Biovortex'],[/maikoya/i,'Maikoya'],[/island water chart/i,'Catalina boat charter'],[/com tam thien huong/i,'Com Tam Thien Huong'],[/golden farmer market/i,'Golden Farmer Market'],
 [/sfmta|mta meter/i,'SFMTA parking'],[/jagalchi/i,'Jagalchi'],[/koi palace/i,'Koi Palace'],[/matsuyama shabu/i,'Matsuyama Shabu House'],[/daeho kalbijjim/i,'Daeho Kalbijjim'],[/stonemill matcha/i,'Stonemill Matcha'],
 [/maruwu seicha/i,'Maruwu Seicha'],[/matcha cafe maiko/i,'Matcha Cafe Maiko'],[/7 leaves/i,'7 Leaves Cafe'],[/happy lemon/i,'Happy Lemon'],[/the alley/i,'The Alley'],[/quickly/i,'Quickly'],[/polkcha/i,'Polkcha'],
 [/philz/i,'Philz Coffee'],[/tram cream/i,'Tram Cream Coffee'],[/haraz coffee/i,'Haraz Coffee'],[/juniper cafe/i,'Juniper Cafe'],[/pacific pipe/i,'Pacific Pipe'],[/fitness sf/i,'Fitness SF'],[/diplos run club/i,"Diplo's Run Club"],
 [/olive young/i,'Olive Young'],[/uniqlo/i,'Uniqlo'],[/g u co ltd/i,'GU'],[/nordrack|nordstrom rack/i,'Nordstrom Rack'],[/peoples barber/i,'Peoples Barber'],[/cut and go/i,'Cut and Go'],[/mlbsungso/i,'MLB'],[/acme de la vie/i,'Acme de la Vie'],
 [/regal/i,'Regal Cinemas'],[/cinemark/i,'Cinemark'],[/maxim karaoke/i,'Maxim Karaoke'],[/seeticket/i,'See Tickets'],[/sierra tickets/i,'Sierra tickets'],[/subpar miniature/i,'Subpar Miniature Golf']];
function nameFix(s){for(const [re,n] of NAMES)if(re.test(s))return n;return null}
function knownCat(s){for(const [re,c] of KNOWN)if(re.test(s))return c;return null}
function legacyCat(c,t){const s=(t.r||'')+' '+(t.m||'');
  if(c==='Bars & Alcohol')return LIQ.test(s)?'Liquor & Wine':'Bars & Nightlife';
  if(c==='Coffee & Treats')return DESSERT.test(s)?'Desserts & Bakery':'Coffee, Tea & Drinks';
  if(!t.u&&c==='Restaurants'&&FAST.test(s))return 'Fast Food';
  return c}
const CAT2G={};GROUPS.forEach(g=>g.cats.forEach(c=>CAT2G[c]=g));
const ALLCATS=[...GROUPS.flatMap(g=>g.cats),...SPECIAL];
const gOf=c=>CAT2G[c]||null;
const colorOf=c=>{const g=gOf(c);return g?`var(${g.c})`:'var(--s0)'};

// ================= Helpers =================
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const U2=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const U0=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const m2=n=>U2.format(n);
const m0=n=>U0.format(Math.round(n));
const mAuto=n=>Math.abs(n)>=1000?m0(n):m2(n);
const mk=n=>{const a=Math.abs(n);return (n<0?'-':'')+(a>=1e6?'$'+(a/1e6).toFixed(1)+'M':a>=1e4?'$'+Math.round(a/1e3)+'k':a>=1e3?'$'+(a/1e3).toFixed(1).replace(/\.0$/,'')+'k':'$'+Math.round(a))};
const r2=n=>Math.round(n*100)/100;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const mLabel=(k,long)=>{const [y,m]=k.split('-');return MONTHS[+m-1]+(long?' '+y:'')};
const dLabel=d=>{const [y,m,dd]=d.split('-');return MONTHS[+m-1]+' '+(+dd)};
const dLabelY=d=>{const [y,m,dd]=d.split('-');return MONTHS[+m-1]+' '+(+dd)+', '+y};
const dow=d=>{const [y,m,dd]=d.split('-').map(Number);return new Date(y,m-1,dd).getDay()};
const dayNum=d=>{const [y,m,dd]=d.split('-').map(Number);return Math.round(Date.UTC(y,m-1,dd)/864e5)};
const addMonths=(k,n)=>{let [y,m]=k.split('-').map(Number);m+=n;while(m>12){m-=12;y++}while(m<1){m+=12;y--}return y+'-'+String(m).padStart(2,'0')};
const monthSpan=(a,b)=>{const o=[];for(let k=a;k<=b;k=addMonths(k,1))o.push(k);return o};
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};

// ================= Merchant names & rule-based categories =================
const BRANDS=[[/doordash/i,'DoorDash'],[/uber\s*\*?\s*eats/i,'Uber Eats'],[/uber/i,'Uber'],[/lyft/i,'Lyft'],[/grubhub/i,'Grubhub'],[/instacart/i,'Instacart'],
 [/amzn|amazon/i,'Amazon'],[/wal-?mart/i,'Walmart'],[/\btarget\b/i,'Target'],[/trader joe/i,"Trader Joe's"],[/whole ?fds|whole foods/i,'Whole Foods'],[/costco gas/i,'Costco Gas'],[/costco/i,'Costco'],
 [/walgreens/i,'Walgreens'],[/\bcvs\b/i,'CVS'],[/starbucks/i,'Starbucks'],[/mta meter|mta mck/i,'SFMTA Parking Meter'],[/clipper/i,'Clipper'],[/chevron/i,'Chevron'],[/shell oil/i,'Shell'],
 [/\barco\b/i,'ARCO'],[/peacock/i,'Peacock'],[/netflix/i,'Netflix'],[/spotify/i,'Spotify'],[/hulu/i,'Hulu'],[/apple\.com|itunes/i,'Apple'],[/google \*/i,'Google'],[/mcdonald/i,"McDonald's"],
 [/taco bell/i,'Taco Bell'],[/raising cane/i,"Raising Cane's"],[/in-n-out/i,'In-N-Out'],[/chipotle/i,'Chipotle'],[/online payment|payment,? thank you|autopay/i,'Card payment'],[/temu/i,'Temu'],[/fedex/i,'FedEx']];
const CITY=/\s+(SAN FRANCISC\w*|SAN FRANCSAN\w*|SACRAMENTO|ELK ?GROVE\w*|CITRUS HEIGHT\w*|RANCHO CORDOV\w*|SANTA ROSA|FAIRFIELD|PITTSBURG|MOUNTAIN VIEW\w*|OAKLAND|SAN JOSE|LOS ANGELES|LAS VEGAS|NEW YORK|SEATTLE|BERKELEY|DALY CITY|CONCORD|ROSEVILLE|FOLSOM|DAVIS|STOCKTON)\b.*$/i;
function cleanName(raw){
  const r=String(raw||'');
  for(const [re,n] of BRANDS)if(re.test(r))return n;
  let s=r.replace(/\b(TST|SQ|DD|PAR|PY|CTLP|TCB|SP|PP|IC|GLF|BT|FSP|EB|LS|PAYPAL|APLPAY)\s?\*\s?/gi,' ')
    .replace(/https?:\/\/\S+|\S+\.(com|net|org)\S*/gi,' ').replace(/\d{3}[-.]?\d{3}[-.]?\d{4}/g,' ')
    .replace(CITY,'').replace(/#\s?\d+/g,' ').replace(/\b\d{3,}\b/g,' ').replace(/\s[A-Z]{2}\s*$/,'')
    .replace(/[*]/g,' ').replace(/\s+-\s*$/,'').replace(/\s{2,}/g,' ').trim().replace(/[-,.]$/,'').trim();
  s=s.replace(/(\s+(&|-|\d+|san|of|the))+$/i,'').replace(/^[-\s]+/,'').trim();
  if(!s)s=r.trim();
  return s.toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase()).replace(/\b(Ii|Iii|Llc|Bbq|Sf|Usa)\b/g,w=>w.toUpperCase()).slice(0,48);
}
const RULES=[
 [/online payment|payment,? thank you|autopay|auto pay|epay|card ?pmt|credit card payment|transfer (to|from)|xfer|payment to .*card/i,'Transfers & Payments'],
 [/payroll|direct dep|salary|paycheck|interest paid|dividend|cash ?back (deposit|redemption)|tax refund/i,'Income'],
 [/doordash|uber\s*\*?\s*eats|grubhub|postmates|caviar|seamless/i,'Food Delivery'],
 [/uber|lyft|taxi|waymo|curb /i,'Rideshare & Taxi'],
 [/membership fee|annual fee|late fee|interest charge|foreign transaction|overdraft|service charge/i,'Fees & Interest'],
 [/netflix|spotify|hulu|disney\s*plus|disneyplus|peacock|hbo|max\.com|youtube|icloud|apple\.com|google \*|prime video|amazon prime|patreon|openai|chatgpt|claude\.ai|anthropic|adobe|microsoft|dropbox|audible|dashpass|\broku\b|paramount|crunchyroll|siriusxm/i,'Subscriptions'],
 [/verizon|at&t|t-mobile|tmobile|comcast|xfinity|spectrum|mint mobile|visible|sonic\.net|google fi/i,'Phone & Internet'],
 [/pg&e|pge|smud|edison|electric|water dist|utility|utilities|sewer|garbage|recology|waste mgmt/i,'Utilities'],
 [/rent\b|apartment|property mgmt|leasing|hoa\b|mortgage|neighbor\.com|neighbor:|storage/i,'Rent & Housing'],
 [/insurance|geico|state farm|progressive|allstate|lemonade/i,'Insurance'],
 [/airline|airlines|jetblue|delta air|united air|southwest|alaska air|\bjal\b|korean air|air premia|ana air|expedia|priceline|kayak|flight/i,'Flights'],
 [/hotel|marriott|hilton|hyatt|airbnb|\binn\b|resort|motel|booking\.com|hostel|vrbo/i,'Lodging'],
 [/cruise|catalina express|ferry (ticket|terminal)|tour\b|tours\b|excursion/i,'Travel & Vacation'],
 [/ticket|stubhub|ticketmaster|seatgeek|eventbrite|\baxs\b|live nation|concert|festival|theater|theatre|masonic|arena|stadium|museum|\bzoo\b|aquarium/i,'Events & Tickets'],
 [/cinema|\bamc\b|regal|movie|bowling|arcade|karaoke|dave & buster|round1|steam|playstation|xbox|nintendo|golf|mini golf|escape room/i,'Entertainment'],
 [/walgreens|\bcvs\b|rite aid|pharmacy|clinic|medical|dental|dentist|doctor|hospital|kaiser|optometr|urgent care|labcorp|quest diag/i,'Pharmacy & Health'],
 [/salon|barber|nail|\bspa\b|sephora|ulta|cosmetic|laundry|serviceworks|dry clean|massage/i,'Personal Care'],
 [/\bgym\b|fitness|24 hour|planet fitness|equinox|yoga|climb|crossfit|peloton|orangetheory/i,'Fitness'],
 [/tuition|udemy|coursera|school|college|university|bookstore/i,'Education'],
 [/church(?!'?s chicken)|donat|charity|parish|ministr|gofundme|red cross/i,'Charity & Giving'],
 [/venmo|zelle|cash app|square cash|paypal \*(?!walmart|wayfair|ebay)/i,'Transfers to People'],
 [/\batm\b|cash withdrawal/i,'Cash & ATM'],
 [/chevron|shell oil|\bshell\b|\barco\b|exxon|\bmobil\b|\b76\b|valero|circle k|speedway|costco gas|gasoline|\bfuel\b|ev charg|chargepoint|supercharger|electrify|evgo/i,'Gas & EV Charging'],
 [/parking|\bpark\b|meter|\btoll|fastrak|impark|spothero|parkmobile|\blaz\b|nra parkin/i,'Parking & Tolls'],
 [/clipper|\bbart\b|caltrain|\bmuni\b|amtrak|metro|transit|greyhound/i,'Public Transit'],
 [/tire|auto(zone| parts| repair)|car wash|jiffy|oil change|\bdmv\b|o'?reilly|smog|mechanic/i,'Auto & Maintenance'],
 [/donut|doughnut|bakery|dessert|ice cream|pinkberry|yogurt|crepe|creamery|cookie|cake|mochi|churro|gelato|pastry/i,'Desserts & Bakery'],
 [/coffee|starbucks|peet|dutch bros|boba|\btea\b|teaspoon|matcha|seicha|jamba|happy lemon|the alley|quickly|kung fu tea|sharetea|7 leaves|juice|smoothie|milk ?tea|cafe|café|tpumps|gong cha|tiger sugar|lemonade/i,'Coffee, Tea & Drinks'],
 [/liquor|wine shop|wine & spirits|spirits|bevmo|beverages & more|total wine|bottle shop/i,'Liquor & Wine'],
 [/juice bar|smoothie bar|coffee bar|espresso bar/i,'Coffee, Tea & Drinks'],
 [/ramen bar|noodle bar|sushi bar|oyster bar|restaurant & bar|restaurant and bar|bar & gri|tea lounge|hong kong lounge/i,'Restaurants'],
 [/cinemark|rstbar/i,'Entertainment'],[/run club/i,'Fitness'],
 [NIGHT,'Bars & Nightlife'],
 [/brewing|brewery|\bbar\b|\bpub\b|tavern|saloon|lounge|taproom|cocktail|nightclub|\bclub\b|zouk|beach club|winery|wine bar/i,'Bars & Nightlife'],
 [/trader joe|whole ?fds|whole foods|safeway|raley|costco whse|kroger|market|supermarket|grocery|groceries|99 ranch|h mart|sprouts|aldi|lucky|save mart|bel air|foods co|food 4 less|smart & final|grocery outlet/i,'Groceries'],
 [/best ?buy|apple store|micro center|b&h|newegg/i,'Electronics'],
 [/uniqlo|h&m|zara|nordstrom|macy|\bgap\b|old navy|nike|adidas|\bross\b|tj ?maxx|marshalls|clothing|apparel|shoes|footlocker/i,'Clothing'],
 [/home depot|lowe'?s|ikea|wayfair|bed bath|hardware|container store|homegoods/i,'Home & Garden'],
 [/amazon|amzn|target|wal-?mart|temu|shein|etsy|ebay|costco|dollar|daiso|fedex|ups store|usps|staples|office depot|michaels|joann|\bmall\b|shopping|store/i,'Shopping'],
 [FAST,'Fast Food'],
 [/restaurant|grill|kitchen|pizza|pizzeria|burger|taco|taqueria|ramen|\bpho\b|sushi|bbq|diner|bistro|noodle|\bwok\b|thai|chicken|wings|mcdonald|carls jr|\bkfc\b|in-n-out|chipotle|subway|panda|raising cane|wendy|jack in the box|five guys|shake shack|eatery|shabu|hot ?pot|dumpling|udon|com tam|curry|seafood|steak|roadhouse|tst\*|par\*|sq \*|toast/i,'Restaurants'],
];
function ruleCat(raw,a){
  for(const [re,c] of RULES)if(re.test(raw)){if(c==='Transfers & Payments'&&a>0&&!/payment|transfer|xfer/i.test(raw))continue;return c}
  return a<0?'Other':'Other';
}
const rawKey=r=>String(r||'').toLowerCase().replace(/\d+/g,'').replace(/[^a-z&' ]+/g,' ').replace(/\s+/g,' ').trim().slice(0,60);

// ================= File reading =================
const PDFJS='lib/';
const loadScript=src=>new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('The PDF reader did not load. Check your connection and try again.'));document.head.appendChild(s)});
let pdfLoading=null;
function loadPdf(){if(window.pdfjsLib&&window.pdfjsWorker)return Promise.resolve();return pdfLoading||(pdfLoading=loadScript(PDFJS+'pdf.min.js').then(()=>loadScript(PDFJS+'pdf.worker.min.js')).then(()=>{pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS+'pdf.worker.min.js'}).catch(e=>{pdfLoading=null;throw e}))}
const NAME_STOP=new Set('STATEMENT ACCOUNT ACCOUNTS SUMMARY PAYMENT PAYMENTS BALANCE CARD CARDS CITI CHASE BANK AMERICA CREDIT DEBIT TOTAL NEW MINIMUM DUE CUSTOMER SERVICE PO BOX VISA MASTERCARD AMEX AMERICAN EXPRESS WELLS FARGO CAPITAL ONE DISCOVER INTEREST FEES FEE TRANSACTIONS TRANSACTION PURCHASES PURCHASE PAGE MEMBER BILLING PREVIOUS ANNUAL PERCENTAGE RATE DATE AMOUNT DESCRIPTION COSTCO REWARDS CASH BACK PERIOD CLOSING OPENING CHECKING SAVINGS ONLINE MOBILE PLEASE SEND MAKE CHECK PAYABLE THE AND OF FOR TO YOUR JANUARY FEBRUARY MARCH APRIL MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER INC LLC CO CORP NA USA US'.split(' '));
const titleCase=s=>String(s).toLowerCase().replace(/(^|[\s'-])([a-z])/g,(m,a,b)=>a+b.toUpperCase());
function holderFromLines(lines){
  const L=lines.slice(0,120),sc={};
  const addr=/^\d{2,6}\s+[A-Z0-9 .'-]+\b(DR|DRIVE|ST|STREET|AVE|AVENUE|RD|ROAD|LN|LANE|CT|COURT|WAY|BLVD|PL|PLACE|CIR|CIRCLE|PKWY|TER|HWY|TRL|LOOP|SQ)\b/i;
  L.forEach((ln,i)=>{
    const m=ln.match(/^((?:[A-Z][A-Z'\-]*\.?\s+){1,3}[A-Z][A-Z'\-]+)(?=\s+[A-Z][a-z]|\s*$|\s+\d)/);if(!m)return;
    const toks=m[1].split(/\s+/);if(toks.length<2||toks[0].length<2||toks.some(t=>NAME_STOP.has(t.replace(/\.$/,''))))return;
    const k=m[1];sc[k]=(sc[k]||0)+1;if(L.slice(i+1,i+4).some(x=>addr.test(x)))sc[k]+=2;
  });
  const best=Object.entries(sc).sort((a,b)=>b[1]-a[1])[0];
  return best&&best[1]>=2?titleCase(best[0]):null;
}
function holderFirst(){const c={};for(const st of Object.values(stmts())){const f=String(st.holder||'').trim().split(/\s+/)[0];if(f)c[f]=(c[f]||0)+1}return (Object.entries(c).sort((a,b)=>b[1]-a[1])[0]||[''])[0]}
async function pdfLines(buf){
  await loadPdf();
  let doc;
  try{doc=await pdfjsLib.getDocument({data:new Uint8Array(buf),isEvalSupported:false}).promise}
  catch(e){throw new Error(/password/i.test(e&&e.name+e.message)?'This PDF is password-protected. Download an unlocked copy from your bank.':'This file could not be opened as a PDF.')}
  const out=[];
  for(let p=1;p<=doc.numPages;p++){
    const pg=await doc.getPage(p);const tc=await pg.getTextContent();const rows=[];
    for(const it of tc.items){if(!it.str||!it.str.trim())continue;const y=it.transform[5],x=it.transform[4];let r=rows.find(r=>Math.abs(r.y-y)<2.5);if(!r){r={y,items:[]};rows.push(r)}r.items.push({x,s:it.str})}
    rows.sort((a,b)=>b.y-a.y);
    for(const r of rows){r.items.sort((a,b)=>a.x-b.x);out.push(r.items.map(i=>i.s).join(' ').replace(/\s+/g,' ').trim())}
  }
  return out;
}
function parseDelimited(text){
  const first=text.split(/\r?\n/).slice(0,5).join('\n');
  const d=[',',';','\t'].map(c=>[c,(first.match(new RegExp(c==='\t'?'\t':'\\'+c,'g'))||[]).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;else if(c===d){row.push(f);f=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f=''}else f+=c}
  if(f||row.length){row.push(f);rows.push(row)}
  return rows.filter(r=>r.some(x=>String(x).trim()));
}
function parseDateAny(v){
  if(v==null||v==='')return null;
  if(typeof v==='number'&&v>20000&&v<80000){const d=new Date(Math.round((v-25569)*864e5));return iso(new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()))}
  const s=String(v).trim();let m;
  if(m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  if(m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)){let y=+m[3];if(y<100)y+=2000;return y+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')}
  const d=new Date(s);return isNaN(d)?null:iso(d);
}
function numAny(v){if(typeof v==='number')return v;let s=String(v||'').trim();if(!s)return null;const neg=/^\(.*\)$/.test(s)||/^-/.test(s)||/-$/.test(s)||/\bDR\b/i.test(s);s=s.replace(/[^\d.]/g,'');if(!s)return null;const n=parseFloat(s);return isNaN(n)?null:(neg?-n:n)}
const NOTE_RULES=[
 [/rent|landlord|lease|🏠|🔑/i,'Rent & Housing'],[/utilit|pg&e|electric|wifi|internet|💡|⚡|📶/i,'Utilities'],
 [/🍻|🍺|🍷|🍸|🥂|🍹|🥃|drinks?|beers?|shots?|\bbar\b|club|cover/i,'Bars & Nightlife'],
 [/☕|🧋|coffee|boba|matcha|latte|tea\b/i,'Coffee, Tea & Drinks'],[/🍩|🍦|🍰|🧁|dessert|donut|ice cream/i,'Desserts & Bakery'],
 [/🌭|hot ?dogs?|^dogs?$|burger|🍔|mcdonald|taco bell|in-n-out|chipotle/i,'Fast Food'],
 [/🍕|🍣|🍜|🍝|🌮|🌯|🥘|🍱|🥟|🍗|food|dinner|lunch|breakfast|brunch|burrito|pizza|sushi|ramen|pho|kbbq|bbq|hot ?pot|meal|eat/i,'Restaurants'],
 [/🛒|groceries|grocery|costco|trader/i,'Groceries'],[/🚕|🚗|uber|lyft|ride|taxi/i,'Rideshare & Taxi'],[/⛽|gas\b/i,'Gas & EV Charging'],[/🅿️|parking/i,'Parking & Tolls'],
 [/✈️|🏨|flight|hotel|airbnb|trip|vacation|vegas|cabin/i,'Travel & Vacation'],[/🎟️|🎫|🎶|🎤|🎵|ticket|concert|festival|show\b|game\b|movie/i,'Events & Tickets'],
 [/⛳|🎳|golf|bowling|karaoke/i,'Entertainment'],[/🎁|gift|birthday|bday/i,'Gifts'],[/🏋️|gym|climb|yoga/i,'Fitness'],[/💇|haircut|nails/i,'Personal Care'],[/🙏|church|tithe|donat/i,'Charity & Giving']];
function venmoCat(note,who){for(const [re,c] of NOTE_RULES)if(re.test(note))return c;const c=ruleCat(String(who||''),1);return c==='Other'?'Transfers to People':c}
function venmoToTxns(rows){
  let h=-1;for(let i=0;i<Math.min(rows.length,10);i++){const r=rows[i].map(x=>String(x).trim().toLowerCase());if(r.includes('datetime')&&r.some(x=>x.startsWith('amount (total)'))){h=i;break}}
  if(h<0)return null;
  const H=rows[h].map(x=>String(x).trim().toLowerCase()),ix=n=>H.indexOf(n);
  const iD=ix('datetime'),iT=ix('type'),iS=ix('status'),iN=ix('note'),iF=ix('from'),iTo=ix('to'),iA=H.findIndex(x=>x.startsWith('amount (total)')),iDest=ix('destination');
  const data=rows.slice(h+1).filter(r=>parseDateAny(r[iD])&&String(r[iA]||'').trim());
  const cnt={};for(const r of data)for(const n of [r[iF],r[iTo]]){const k=String(n||'').trim();if(k)cnt[k]=(cnt[k]||0)+1}
  const me=(Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]||[''])[0];
  const handle=((rows[0]||[]).join(' ').match(/\(@([^)]+)\)/)||[])[1];
  const out=[];
  for(const r of data){
    const st=String(r[iS]||'').toLowerCase();if(st&&!/complete|issued|success|settled/.test(st))continue;
    let a=numAny(r[iA]);if(!a)continue;a=-a;
    const type=String(r[iT]||'').trim(),note=String(r[iN]||'').replace(/\s+/g,' ').trim(),from=String(r[iF]||'').trim(),to=String(r[iTo]||'').trim();
    const who=a>0?(to&&to!==me?to:from):(from&&from!==me?from:to);
    const xfer=/transfer/i.test(type)||(!from&&!to);
    out.push({d:parseDateAny(r[iD]),a:r2(a),venmo:true,note,who,
      raw:(xfer?`Venmo ${type}${r[iDest]?' to '+String(r[iDest]).trim():''}`:`Venmo ${a>0?'to':'from'} ${who}${note?': '+note:''}`).slice(0,120),
      m:xfer?'Venmo transfer':(who||'Venmo').slice(0,48),c:xfer?'Transfers & Payments':null});
  }
  out.holder=me?titleCase(me):null;out.kind='venmo';out.account='Venmo'+(handle?' (@'+handle+')':'');return out;
}
function tableToTxns(rows){
  const vm=venmoToTxns(rows);if(vm)return vm;
  let h=-1,cols=null;
  for(let i=0;i<Math.min(rows.length,15);i++){
    const r=rows[i].map(x=>String(x).toLowerCase().trim());
    const date=r.findIndex(x=>/trans(action)?\.? ?date/.test(x));const date2=r.findIndex(x=>/date/.test(x));
    const desc=r.findIndex(x=>/description|merchant|payee|^name$|memo|details|narrative|transaction$/.test(x));
    const amt=r.findIndex(x=>/^amount|amount$|amount \(|^amt/.test(x));
    const deb=r.findIndex(x=>/debit|withdrawal|money out|^charge/.test(x));
    const cre=r.findIndex(x=>/credit|deposit|money in/.test(x));
    if((date>=0||date2>=0)&&desc>=0&&(amt>=0||deb>=0||cre>=0)){h=i;cols={date:date>=0?date:date2,desc,amt,deb,cre};break}
  }
  if(h<0)throw new Error('Could not find Date, Description and Amount columns in this file.');
  const out=[];
  for(const r of rows.slice(h+1)){
    const d=parseDateAny(r[cols.date]);if(!d)continue;
    const raw=String(r[cols.desc]||'').trim();if(!raw)continue;
    let a=null;
    if(cols.amt>=0)a=numAny(r[cols.amt]);
    if(a==null){const db=cols.deb>=0?numAny(r[cols.deb]):null,cr=cols.cre>=0?numAny(r[cols.cre]):null;if(db==null&&cr==null)continue;a=Math.abs(db||0)-Math.abs(cr||0)}
    else a=-a; // amount columns usually use negative = money out; normalised below
    if(!a)continue;
    out.push({d,raw,a:r2(a)});
  }
  if(cols.amt>=0){ // most rows are purchases: make purchases positive
    const pos=out.filter(t=>t.a>0).length;if(pos<out.length/2)out.forEach(t=>t.a=-t.a);
  }
  return out;
}
let xlsxLoading=null;
function loadXLSX(){if(window.XLSX)return Promise.resolve();return xlsxLoading||(xlsxLoading=new Promise((res,rej)=>{const s=document.createElement('script');s.src='lib/xlsx.full.min.js';s.onload=res;s.onerror=()=>rej(new Error('The spreadsheet reader did not load.'));document.head.appendChild(s)}))}
async function hashBuf(buf){
  try{const h=await crypto.subtle.digest('SHA-256',buf);return [...new Uint8Array(h)].slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('')}
  catch(e){let h1=0x811c9dc5,h2=0x1000193;const u=new Uint8Array(buf);for(let i=0;i<u.length;i++){h1=Math.imul(h1^u[i],16777619);h2=Math.imul(h2+u[i],2654435761)}return (h1>>>0).toString(16)+(h2>>>0).toString(16)+u.length.toString(16)}
}
function accountFromText(text){
  const last4=(text.match(/(?:ending in|ending|acct\.? #?|account number)[:\s]*(?:x+|\*+|\.+)?\s*(\d{4})\b/i)||[])[1];
  const names=[/costco anywhere visa/i,/citi custom cash/i,/citi double cash/i,/citi premier/i,/sapphire (preferred|reserve)/i,/freedom (unlimited|flex)?/i,/amazon prime visa/i,/venture x?/i,/quicksilver/i,/savor(one)?/i,/blue cash (everyday|preferred)/i,/gold card/i,/platinum card/i,/apple card/i,/discover it/i,/active cash/i,/total checking/i,/everyday checking/i,/checking/i,/savings/i];
  let n=null;for(const re of names){const m=text.match(re);if(m){n=m[0];break}}
  if(/costco/i.test(text)&&/citi/i.test(text))n='Costco Anywhere Visa';
  const inst=(text.match(/\b(Citi|Chase|Bank of America|Wells Fargo|Capital One|American Express|Discover|U\.?S\.? Bank|Apple Card|Ally|SoFi|Schwab|Golden 1|Navy Federal)\b/i)||[])[1];
  let label=n?n.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bVisa\b/i,'Visa'):(inst||'Account');
  if(inst&&n&&!label.toLowerCase().includes(inst.toLowerCase().split(' ')[0])&&!/costco/i.test(label))label=inst+' '+label;
  return label+(last4?' ••'+last4:'');
}

// ================= Claude =================
let sampleFn=null;
const CAT_HELP=GROUPS.map(g=>`${g.name}: ${g.cats.join(', ')}`).join('\n')+'\nNot spending: Income, Transfers & Payments';
async function aiCategorize(items,header,tier='default'){
  const out={};let account=null;
  for(let i=0;i<items.length;i+=120){
    const chunk=items.slice(i,i+120);
    const list=chunk.map((it,j)=>`${j+1} | ${it.raw.slice(0,90)} | ${it.a.toFixed(2)}`).join('\n');
    const prompt=`You categorize bank and credit card transactions for a personal budgeting dashboard.

For each numbered item, give a clean merchant name and exactly one category.
- Clean name: the business or person people would recognize, in normal Title Case. Drop store numbers, phone numbers, cities, states and processor prefixes like TST*, SQ *, DD *, PAR*, PY *, PAYPAL *. Examples: "DD *DOORDASH JACKINTHE" -> "DoorDash", "TST*TAISHOKEN RAMEN - San Francisco CA" -> "Taishoken Ramen", "UBER *TRIP HELP.UBER.COMCA" -> "Uber", "TCB*MTA METER MTA MCK" -> "SFMTA Parking Meter".
- Category must be copied exactly from this list (group: categories):
${CAT_HELP}
- Credit card payments, autopay and transfers between the person's own accounts are "Transfers & Payments". Paychecks, direct deposits, interest earned and cash-back deposits are "Income". A refund (negative amount) takes the category of what was refunded.
- Use everything you know about businesses worldwide, including ones abroad and romanized Japanese or Korean names. A city like Tokyo, Seoul or Kyoto in the description means the person was traveling: still pick what the business is (a Tokyo ramen shop is Restaurants, a Seoul cosmetics store is Personal Care or Shopping), but hotel and booking sites (Tripla, Agoda, Booking.com) are Lodging and tours or experiences are Travel & Vacation. Venues and ticket sellers (Tixr, Dice, Eventbrite, civic auditoriums) are Events & Tickets. Bars, clubs, lounges, music venues with bar tabs and breweries are "Bars & Nightlife" even when they also serve food: if a place is best known as a bar, cocktail spot or nightclub (for example Harper & Rye, 1015 Folsom, Temple, Monroe, Raven Bar, Encore Beach Club, Zouk), choose "Bars & Nightlife". Several small charges at the same venue on one day usually mean a bar tab. But a juice bar, ramen or sushi bar, or a "Restaurant & Bar" is food, and a dim sum "lounge" or tea lounge is not nightlife. Liquor, wine and beverage stores are "Liquor & Wine".
- Smoke shops, tobacco and hookah are "Smoke & Vape". Convenience stores (7-Eleven, FamilyMart, Lawson, GS25, CU) are "Groceries". A purchase abroad at a business you can't identify is "Travel & Vacation", not "Other". Workplace cafeterias are "Restaurants". Golf courses, mini golf and movie ticket sites are "Entertainment".
- Descriptions like "Venmo to <person>: <note>" or "Venmo from <person>: <note>" are Venmo payments. Choose the category from the note and emojis (🍕 or pizza → Restaurants, rent → Rent & Housing, 🍻 → Bars & Nightlife, uber → Rideshare & Taxi). Money from a friend paying you back takes the category of what it was for. If the note gives no clue, use "Transfers to People". The clean name is the person or business.
- Use "Other" only when the description gives no clue at all. Restaurant delivery apps are "Food Delivery". Trader Joe's, Costco (not Costco Gas), Walgreens, CVS, Target, Walmart and other grocery stores are "Groceries"; Amazon and other retailers are "Shopping". Quick-service chains and counter-service burger, taco, chicken and sandwich spots (McDonald's, Taco Bell, In-N-Out, Chipotle, Raising Cane's) are "Fast Food"; sit-down and independent restaurants are "Restaurants". Non-alcoholic drink shops (coffee, Starbucks, matcha, boba and milk tea, juice and smoothies like Jamba) are "Coffee, Tea & Drinks"; donut shops, bakeries and dessert places are "Desserts & Bakery".
${header&&i===0?`\nAlso name the account from this statement header, like "Citi Custom Cash ••1087" or "Chase Checking ••4421" (card or account product name plus last 4 digits when shown):\n<<<\n${header.slice(0,1800)}\n>>>\n`:''}
Items (number | description | amount, positive = money out, negative = money in):
${list}

Reply with only JSON in this shape: {"account": ${header&&i===0?'"..."':'null'}, "items": [[1, "Clean Name", "Category"], ...]} with one entry per item.`;
    const res=await sampleFn.json(prompt,{modelTier:tier,cache:{gcTime:86400000}});
    if(res&&res.account&&!account)account=String(res.account).slice(0,60);
    for(const e of (res&&res.items)||[]){
      const it=chunk[(+e[0])-1];if(!it)continue;
      const cat=ALLCATS.includes(e[2])?e[2]:null;
      out[it.key]={m:String(e[1]||'').slice(0,48)||cleanName(it.raw),c:cat||ruleCat(it.raw,it.a)};
    }
  }
  return {map:out,account};
}
async function aiExtract(lines){
  const text=lines.filter(l=>l.length<220||/\$\d/.test(l)).join('\n').slice(0,90000);
  const prompt=`Extract every transaction from this bank or credit card statement for a budgeting dashboard. The text was pulled from a PDF, so side panels (rewards, ads, notices) may be merged onto transaction lines and a description can wrap onto the line above or below its amount. Ignore rewards, points, interest-rate tables and summary lines.

<<<
${text}
>>>

Reply with only JSON:
{"account":"product name plus last 4 digits, e.g. Chase Freedom ••1234","periodStart":"YYYY-MM-DD","periodEnd":"YYYY-MM-DD",
"reported":{"purchases":n|null,"fees":n|null,"interest":n|null,"cashAdvances":n|null,"payments":n|null,"credits":n|null,"deposits":n|null,"withdrawals":n|null},
"txns":[["YYYY-MM-DD","description as printed", amount, "Clean Name", "Category"], ...]}
Rules: "reported" copies the totals printed in the statement's summary (positive numbers; null when not printed). amount is positive for money out (purchases, withdrawals, fees, interest, checks) and negative for money in (payments, credits, refunds, deposits). Use the transaction date (the first date when two are shown) and the statement period to fill in the year. Include each transaction exactly once.
Category must be copied exactly from this list (group: categories):
${CAT_HELP}
Card payments and transfers between own accounts are "Transfers & Payments"; paychecks and deposits are "Income".`;
  const res=await sampleFn.json(prompt,{modelTier:'default',cache:{gcTime:86400000}});
  if(!res||!Array.isArray(res.txns))throw new Error('Claude could not find transactions in this statement.');
  const txns=res.txns.map(t=>({d:parseDateAny(t[0]),raw:String(t[1]||''),a:r2(+t[2]),m:String(t[3]||'')||cleanName(t[1]),c:ALLCATS.includes(t[4])?t[4]:ruleCat(String(t[1]),+t[2])})).filter(t=>t.d&&isFinite(t.a)&&t.a!==0);
  return {txns,account:res.account||null,period:res.periodStart&&res.periodEnd?{start:res.periodStart,end:res.periodEnd}:null,reported:res.reported||null};
}
const aiErr=e=>({not_granted:'Claude access was declined, so built-in rules were used.',rate_limited:'Claude is busy right now, so built-in rules were used.',sampling_disabled:'Claude isn’t available on this account, so built-in rules were used.'}[e&&e.code]||'Claude couldn’t categorize this file, so built-in rules were used.');

// ================= Store (encrypted, on this device only) =================
const S={mode:'loading',statements:{},meta:{rules:{},budgets:{}},merchants:{},example:null};
const VAULT_KEY='pb.vault.v1';
const AUTO_LOCK_MS=10*60*1000;
const V={key:null,salt:null,fails:0,waitUntil:0};
const b64=u=>{let s='';const a=new Uint8Array(u);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000));return btoa(s)};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function deriveKey(pass,salt){
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function sealWith(key,salt,obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj)));
  return {app:'pocketbook',v:1,kdf:'PBKDF2-SHA256-600000',salt:b64(salt),iv:b64(iv),ct:b64(ct)};
}
async function openWith(pass,vault){
  const salt=unb64(vault.salt);const key=await deriveKey(pass,salt);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(vault.iv)},key,unb64(vault.ct));
  return {key,salt,data:JSON.parse(new TextDecoder().decode(pt))};
}
function readVault(){try{const r=localStorage.getItem(VAULT_KEY);return r?JSON.parse(r):null}catch(e){return null}}
function payload(){return {statements:S.statements,meta:S.meta,merchants:S.merchants}}
let persistT=null,persisting=Promise.resolve();
function persistSoon(){clearTimeout(persistT);persistT=setTimeout(persistNow,300)}
function persistNow(){
  if(!V.key)return persisting;
  persisting=persisting.then(async()=>{
    try{localStorage.setItem(VAULT_KEY,JSON.stringify(await sealWith(V.key,V.salt,payload())))}
    catch(e){toast(/quota/i.test(e&&e.name+e.message)?'This device is out of space for Spend It. Export a backup and remove older statements.':'Couldn’t save on this device. Your browser may be blocking storage.')}
  });
  return persisting;
}
function write(){if(S.mode==='local')persistSoon();return Promise.resolve()}
function saveMeta(){write()}
function saveMerchants(){write()}
function setSaveState(kind,text){const el=$('#saveState');el.innerHTML=`<i class="dot ${kind}"></i><span>${esc(text)}</span>`}
function applyData(d){S.statements=d.statements||{};S.meta={rules:{},budgets:{},...(d.meta||{})};S.merchants=d.merchants||{}}
async function initStore(){
  if(!(window.crypto&&crypto.subtle)){UI.lock='nocrypto';S.mode='loading';render();return}
  UI.lock=readVault()?'unlock':'setup';render();
}
async function unlock(pass){
  const vault=readVault();if(!vault){UI.lock='setup';render();return}
  if(Date.now()<V.waitUntil)throw new Error(`Too many tries. Wait ${Math.ceil((V.waitUntil-Date.now())/1000)} seconds.`);
  try{const r=await openWith(pass,vault);V.key=r.key;V.salt=r.salt;V.fails=0;applyData(r.data)}
  catch(e){V.fails++;if(V.fails>=5){V.waitUntil=Date.now()+30000;V.fails=0}throw new Error('That passcode didn’t work.')}
  S.mode='local';UI.lock=null;setSaveState('ok','Encrypted on this device');armAutoLock();pendingRender=false;if(document.activeElement)document.activeElement.blur();render();
}
async function createVault(pass){
  V.salt=crypto.getRandomValues(new Uint8Array(16));V.key=await deriveKey(pass,V.salt);
  S.mode='local';UI.lock='guide';await persistNow();setSaveState('ok','Encrypted on this device');armAutoLock();pendingRender=false;if(document.activeElement)document.activeElement.blur();render();
}
async function changePasscode(pass){
  V.salt=crypto.getRandomValues(new Uint8Array(16));V.key=await deriveKey(pass,V.salt);await persistNow();
}
async function lockNow(){
  if(!V.key)return;
  clearTimeout(persistT);await persistNow();
  V.key=null;V.salt=null;S.statements={};S.meta={rules:{},budgets:{}};S.merchants={};S.example=null;S.mode='loading';
  UI.lock='unlock';closeSheet&&sheetOpen&&closeSheet();setSaveState('','Locked');render();
}
function eraseAll(){try{localStorage.removeItem(VAULT_KEY)}catch(e){}V.key=null;V.salt=null;applyData({});S.mode='loading';UI.lock='setup';render()}
let idleT=null;
function armAutoLock(){clearTimeout(idleT);if(V.key)idleT=setTimeout(lockNow,AUTO_LOCK_MS)}
['pointerdown','keydown','wheel','touchstart'].forEach(ev=>addEventListener(ev,armAutoLock,{passive:true}));
document.addEventListener('visibilitychange',()=>{if(document.hidden)persistNow()});
function downloadFile(name,text,type){
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function exportBackup(){await persistNow();const v=readVault();if(!v)return;downloadFile(`spend-it-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(v),'application/json');toast('Backup saved. It’s encrypted with your passcode.')}
let pendingImport=null;
function stmts(){return S.example||S.statements}

function lockView(){
  const mode=UI.lock;
  if(mode==='nocrypto')return `<section class="card lock"><h2>Open Spend It over https</h2><p class="lede">This browser can’t encrypt your data here. Open Spend It from its https:// address (not a file on your computer) to use it.</p></section>`;
  const setup=mode==='setup';
  return `<section class="card lock">
    <div class="lock-ic" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>
    <h2>${setup?'Create a passcode':'Unlock Spend It'}</h2>
    <p class="lede">${setup?'Your statements stay on this device and are encrypted with this passcode. Nobody else can open them, including whoever runs this site.':'Enter your passcode to open your dashboard.'}</p>
    <form id="lockForm" class="lock-form" autocomplete="off">
      <input class="pass" id="pass1" type="password" inputmode="text" autocomplete="${setup?'new-password':'current-password'}" placeholder="${setup?'New passcode (at least 6 characters)':'Passcode'}" aria-label="Passcode" required minlength="${setup?6:1}">
      ${setup?'<input class="pass" id="pass2" type="password" autocomplete="new-password" placeholder="Type it again" aria-label="Confirm passcode" required>':''}
      <button class="btn primary" type="submit" id="lockGo">${setup?'Create passcode':'Unlock'}</button>
      <p class="lock-err" id="lockErr" role="alert"></p>
    </form>
    ${setup?`<p class="fine">There’s no way to recover a forgotten passcode, because nobody else has a copy. Pick one you’ll remember.</p>
      <p class="fine"><button class="linkish" type="button" data-act="import-pick">Restore from a backup file</button></p>`
      :`<p class="fine">Forgot it? Your data can’t be recovered without it. <button class="linkish danger" type="button" data-act="erase">Erase everything and start over</button></p>`}
  </section>`;
}
document.addEventListener('submit',async e=>{
  if(e.target.id==='importForm'){e.preventDefault();
    const pass=$('#impPass').value,err=$('#impErr');err.textContent='';
    try{const r=await openWith(pass,pendingImport);V.key=r.key;V.salt=r.salt;applyData(r.data);S.mode='local';UI.lock=null;pendingImport=null;await persistNow();setSaveState('ok','Encrypted on this device');armAutoLock();pendingRender=false;if(document.activeElement)document.activeElement.blur();render();toast('Backup restored.')}
    catch(x){err.textContent='That passcode didn’t open this backup.'}
    return}
  if(e.target.id!=='lockForm')return;e.preventDefault();
  const p1=$('#pass1').value,p2=$('#pass2')&&$('#pass2').value,err=$('#lockErr'),btn=$('#lockGo');err.textContent='';
  if(UI.lock==='setup'){
    if(p1.length<6){err.textContent='Use at least 6 characters.';return}
    if(p1!==p2){err.textContent='Those two passcodes don’t match.';return}
    btn.disabled=true;btn.textContent='Setting up…';await createVault(p1);
  }else{
    btn.disabled=true;btn.textContent='Unlocking…';
    try{await unlock(p1)}catch(x){err.textContent=x.message;btn.disabled=false;btn.textContent='Unlock';$('#pass1').select()}
  }
});


// ================= Derivation =================
function allTxns(){
  const out=[],seen={};
  const list=Object.entries(stmts()).sort((a,b)=>((a[1].period||{}).start||'').localeCompare((b[1].period||{}).start||''));
  const hasVenmo=list.some(([,s])=>s.source==='venmo');
  for(const [sid,st] of list){
    const lc={};
    (st.txns||[]).forEach((t,i)=>{
      const dk=(st.account||'')+'|'+t.d+'|'+t.a+'|'+(t.r||t.m);
      lc[dk]=(lc[dk]||0)+1;
      if(seen[dk]&&seen[dk].sid!==sid&&lc[dk]<=seen[dk].n)return;
      if(!seen[dk]||seen[dk].sid===sid)seen[dk]={sid,n:lc[dk]};
      const key=(t.m||'').toLowerCase();
      let cat=legacyCat(t.u?t.c:(S.meta.rules[key]||t.c||'Other'),t);if(hasVenmo&&st.source!=='venmo'&&!t.u&&/venmo/i.test(t.r||''))cat='Transfers & Payments';if(!t.u&&!S.meta.rules[key]&&(cat==='Restaurants'||cat==='Other'||cat==='Fast Food'||cat==='Bars & Nightlife')){const s0=(t.r||'')+' '+(t.m||'');if(isNight(s0))cat='Bars & Nightlife';else if(cat==='Bars & Nightlife'&&NOT_NIGHT.test(s0))cat=/juice|smoothie|coffee|espresso|boba|milk tea/i.test(s0)?'Coffee, Tea & Drinks':/cinemark|rstbar/i.test(s0)?'Entertainment':/run club/i.test(s0)?'Fitness':'Restaurants'}if(!t.u&&!S.meta.rules[key]&&cat!=='Income'&&cat!=='Transfers & Payments'&&!/costco\s*gas|gas station|fuel/i.test((t.r||'')+' '+(t.m||''))&&GROC.test((t.r||'')+' '+(t.m||'')))cat='Groceries';if(!t.u&&!S.meta.rules[key]){const kc=knownCat((t.r||'')+' '+(t.m||''));if(kc)cat=kc}if(!ALLCATS.includes(cat))cat='Other';
      out.push({id:sid+':'+i,sid,i,d:t.d,m:nameFix(t.r||'')||t.m||cleanName(t.r),r:t.r||'',a:t.a,cat,key,kind:cat==='Income'?'income':cat==='Transfers & Payments'?'transfer':'spend',acct:st.account||'Account'});
    });
  }
  return out.sort((a,b)=>b.d.localeCompare(a.d)||b.a-a.a);
}
const UI={view:'overview',range:ls.get('pb.range')||'all',acct:'all',group:null,q:'',catF:'all',kindF:'all',limit:150,budMonth:null,showAllCats:false};
function monthsPresent(T){return [...new Set(T.map(t=>t.d.slice(0,7)))].sort()}
function rangeBounds(T){
  const ms=monthsPresent(T);if(!ms.length)return null;
  const last=ms[ms.length-1],first=ms[0];const r=UI.range;
  if(/^\d{4}-\d{2}$/.test(r))return {from:r,to:r,single:true};
  if(r==='3m')return {from:[addMonths(last,-2),first].sort()[1],to:last};
  if(r==='6m')return {from:[addMonths(last,-5),first].sort()[1],to:last};
  if(r==='12m')return {from:[addMonths(last,-11),first].sort()[1],to:last};
  if(r==='ytd')return {from:[last.slice(0,4)+'-01',first].sort()[1],to:last};
  return {from:first,to:last};
}
function filterT(T,b){return T.filter(t=>(UI.acct==='all'||t.acct===UI.acct)&&(!b||(t.d.slice(0,7)>=b.from&&t.d.slice(0,7)<=b.to)))}
function sumBy(arr,kf,vf=t=>t.a){const m=new Map();for(const t of arr){const k=kf(t);m.set(k,(m.get(k)||0)+vf(t))}return m}

// ================= Tooltips =================
const TIPS=[];
const tipId=html=>{TIPS.push(html);return TIPS.length-1};
const tipRow=(label,val,color)=>`<div class="t-r"><span>${color?`<i class="sw" style="background:${color};width:9px;height:9px;border-radius:3px"></i>`:''}${esc(label)}</span><b>${val}</b></div>`;
function showTip(el,x,y){
  const tip=$('#tip');const i=+el.getAttribute('data-tip');if(!(i in TIPS))return;
  tip.innerHTML=TIPS[i];tip.classList.add('show');
  const r=tip.getBoundingClientRect();let tx=x+14,ty=y+14;
  if(tx+r.width>innerWidth-8)tx=x-r.width-14;if(ty+r.height>innerHeight-8)ty=y-r.height-14;
  tip.style.left=Math.max(8,tx)+'px';tip.style.top=Math.max(8,ty)+'px';
  const ch=el.closest('.chart');if(ch){ch.classList.add('hovering');ch.querySelectorAll('.hot').forEach(n=>n.classList.remove('hot'));const col=el.getAttribute('data-col');if(col!=null)ch.querySelectorAll(`[data-col="${col}"]`).forEach(n=>n.classList.add('hot'))}
}
function hideTip(){$('#tip').classList.remove('show');document.querySelectorAll('.chart.hovering').forEach(c=>c.classList.remove('hovering'))}
document.addEventListener('pointermove',e=>{if(drag){hideTip();return}const el=e.target.closest&&e.target.closest('[data-tip]');if(el)showTip(el,e.clientX,e.clientY);else hideTip()});
document.addEventListener('focusin',e=>{const el=e.target.closest&&e.target.closest('[data-tip]');if(el){const r=el.getBoundingClientRect();showTip(el,r.left+r.width/2,r.top)}});
document.addEventListener('focusout',hideTip);
addEventListener('scroll',hideTip,{passive:true});

// ================= Charts =================
function niceMax(v){if(v<=0)return 1;const p=Math.pow(10,Math.floor(Math.log10(v)));const n=v/p;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p}
function donut(parts,total,centerLabel){
  const R=100,r=66,cx=110,cy=110;let a0=-Math.PI/2;let s='';
  const pos=parts.filter(p=>p.value>0);const tot=pos.reduce((x,p)=>x+p.value,0)||1;
  if(pos.length===1){const p=pos[0];s+=`<circle class="mk" cx="${cx}" cy="${cy}" r="${(R+r)/2}" style="fill:none;stroke:${p.color};stroke-width:${R-r}" data-tip="${p.tip}" data-col="${p.id}" tabindex="0"/>`}
  else for(const p of pos){
    const a1=a0+p.value/tot*Math.PI*2;const large=a1-a0>Math.PI?1:0;
    const P=(rad,a)=>[cx+rad*Math.cos(a),cy+rad*Math.sin(a)].map(n=>n.toFixed(2)).join(' ');
    s+=`<path class="mk" d="M${P(R,a0)} A${R} ${R} 0 ${large} 1 ${P(R,a1)} L${P(r,a1)} A${r} ${r} 0 ${large} 0 ${P(r,a0)} Z" style="fill:${p.color};stroke:var(--surface);stroke-width:2;stroke-linejoin:round" data-tip="${p.tip}" data-col="${p.id}" data-group="${p.id}" tabindex="0"/>`;
    a0=a1;
  }
  s+=`<text x="${cx}" y="${cy-2}" text-anchor="middle" style="fill:var(--ink);font:600 22px var(--font-ui)">${mk(total)}</text><text x="${cx}" y="${cy+18}" text-anchor="middle" style="font-size:12.5px">${esc(centerLabel)}</text>`;
  return `<div class="chart"><svg viewBox="0 0 220 220" role="img" aria-label="Spending by category group">${s}</svg></div>`;
}
function columns({labels,series,stacked=true,height=250,colTips,highlight=null,fmt=mk,W=760,brush=null}){
  W=Math.max(280,Math.round(W));
  const H=height,L=46,Rr=6,T=10,B=26,iw=W-L-Rr,ih=H-T-B,n=labels.length;
  const totals=labels.map((_,i)=>stacked?series.reduce((s,se)=>s+Math.max(0,se.values[i]||0),0):Math.max(0,...series.map(se=>se.values[i]||0)));
  const ymax=niceMax(Math.max(...totals,1));const y=v=>T+ih-(v/ymax)*ih;
  let s='';
  for(let k=0;k<=4;k++){const v=ymax*k/4,yy=y(v).toFixed(1);s+=`<line class="${k?'grid-l':'base'}" x1="${L}" x2="${W-Rr}" y1="${yy}" y2="${yy}"/><text x="${L-8}" y="${+yy+4}" text-anchor="end">${fmt(v)}</text>`}
  const band=iw/n;const groups=stacked?1:series.length;const bw=Math.min(stacked?28:16,band*(stacked?.56:.34));
  const maxLab=Math.max(2,Math.floor(iw/(labels.some(l=>l.length>4)?58:40)));const every=Math.ceil(n/maxLab);
  labels.forEach((lab,i)=>{
    const cx=L+band*i+band/2;
    const dim=highlight!=null&&highlight!==i;
    if(stacked){
      let base=0;const segs=series.map(se=>({se,v:Math.max(0,se.values[i]||0)})).filter(x=>x.v>0);
      segs.forEach((x,j)=>{
        const y0=y(base),y1=y(base+x.v);base+=x.v;const top=j===segs.length-1;
        let h=y0-y1-(j>0?2:0);if(h<=0)return;const yb=y0-(j>0?2:0);const yt=yb-h;const rr=top?Math.min(4,h):0;const x0=cx-bw/2;
        s+=`<path class="mk" data-col="${i}" style="fill:${x.se.color};${dim?'opacity:.35':''}" d="M${x0} ${yb} V${yt+rr} Q${x0} ${yt} ${x0+rr} ${yt} H${x0+bw-rr} Q${x0+bw} ${yt} ${x0+bw} ${yt+rr} V${yb} Z"/>`;
      });
    }else{
      series.forEach((se,j)=>{const v=Math.max(0,se.values[i]||0);if(!v)return;const x0=cx-(groups*bw+(groups-1)*2)/2+j*(bw+2);const yt=y(v),yb=y(0);const h=yb-yt,rr=Math.min(4,h);
        s+=`<path class="mk" data-col="${i}" style="fill:${se.color};${dim?'opacity:.35':''}" d="M${x0} ${yb} V${yt+rr} Q${x0} ${yt} ${x0+rr} ${yt} H${x0+bw-rr} Q${x0+bw} ${yt} ${x0+bw} ${yt+rr} V${yb} Z"/>`});
    }
    if(i%every===0)s+=`<text x="${cx}" y="${H-7}" text-anchor="middle" ${highlight===i?'style="fill:var(--ink);font-weight:600"':''}>${esc(lab)}</text>`;
    if(colTips)s+=`<rect x="${L+band*i}" y="${T}" width="${band}" height="${ih}" fill="transparent" data-tip="${colTips[i]}" data-col="${i}" tabindex="-1"/>`;
  });
  if(brush)return `<div class="chart" data-brush="${brush}" data-l="${L}" data-band="${band}" data-w="${W}" data-n="${n}"><svg viewBox="0 0 ${W} ${H}" role="img"><rect class="brush-band" x="0" y="${T}" width="0" height="${ih}" rx="6"/>${s}</svg></div>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg></div>`;
}
// ---- drag to select months ----
const BR={};let drag=null;
function colAt(ch,clientX){const svg=ch.querySelector('svg'),r=svg.getBoundingClientRect();const x=(clientX-r.left)*(+ch.dataset.w/r.width);return Math.max(0,Math.min(+ch.dataset.n-1,Math.floor((x-+ch.dataset.l)/+ch.dataset.band)))}
function selIdx(months,sel){if(!sel)return null;const a=months.indexOf(sel[0]),b=months.indexOf(sel[1]);if(a<0||b<0)return null;return [Math.min(a,b),Math.max(a,b)]}
function brushSumHtml(id,sel){
  const R=BR[id];if(!R)return '';const ix=selIdx(R.months,sel);
  if(!ix)return `<span class="muted brush-hint">Click and drag across the bars to total any months</span>`;
  const [a,b]=ix,n=b-a+1;const tots=R.series.map(se=>({se,t:se.values.slice(a,b+1).reduce((x,v)=>x+v,0)}));
  const tt=tots.reduce((x,o)=>x+o.t,0);
  const lab=a===b?mLabel(R.months[a],true):`${mLabel(R.months[a])}${R.months[a].slice(0,4)!==R.months[b].slice(0,4)?' '+R.months[a].slice(0,4):''} – ${mLabel(R.months[b],true)}`;
  const chips=tots.filter(o=>o.t>0).sort((x,y)=>y.t-x.t).slice(0,R.top||4).map(o=>`<span class="bs-chip"><i class="sw" style="background:${o.se.color}"></i>${esc(o.se.name)} <b>${m0(o.t)}</b>${n>1?` <span class="muted">· ${m0(o.t/n)}/mo</span>`:''}</span>`).join('');
  return `<div class="bs-main"><span class="bs-range">${esc(lab)}</span><span class="muted">${n} month${n>1?'s':''}</span><span>Total <b>${m0(tt)}</b></span>${n>1?`<span>Average <b>${m0(tt/n)}</b>/mo</span>`:''}<button class="btn ghost bs-x" data-act="brush-clear" aria-label="Clear month selection">Clear</button></div><div class="bs-chips">${chips}</div>`;
}
function paintSel(sel){
  document.querySelectorAll('.chart[data-brush]').forEach(ch=>{
    const R=BR[ch.dataset.brush];if(!R)return;const ix=selIdx(R.months,sel);const band=ch.querySelector('.brush-band');
    ch.classList.toggle('has-sel',!!ix);
    ch.querySelectorAll('.mk[data-col]').forEach(m=>{const c=+m.getAttribute('data-col');m.classList.toggle('out',!!ix&&(c<ix[0]||c>ix[1]))});
    if(band){if(ix){const l=+ch.dataset.l,bw=+ch.dataset.band;band.setAttribute('x',l+bw*ix[0]+1);band.setAttribute('width',Math.max(0,bw*(ix[1]-ix[0]+1)-2))}else band.setAttribute('width',0)}
  });
  document.querySelectorAll('[data-brush-sum]').forEach(el=>{el.innerHTML=brushSumHtml(el.dataset.brushSum,sel);el.classList.toggle('on',!!selIdx((BR[el.dataset.brushSum]||{}).months||[],sel))});
}
document.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;const ch=e.target.closest&&e.target.closest('.chart[data-brush]');if(!ch)return;const R=BR[ch.dataset.brush];if(!R)return;
  const i=colAt(ch,e.clientX);drag={ch,R,a:i,b:i,x:e.clientX,moved:false,prev:UI.selMonths};hideTip();
  try{ch.setPointerCapture(e.pointerId)}catch(x){}
  if(e.pointerType==='mouse')e.preventDefault();
});
document.addEventListener('pointermove',e=>{
  if(!drag)return;if(Math.abs(e.clientX-drag.x)>4)drag.moved=true;
  const i=colAt(drag.ch,e.clientX);if(i!==drag.b||drag.moved){drag.b=i;UI.selMonths=[drag.R.months[drag.a],drag.R.months[drag.b]];paintSel(UI.selMonths)}
});
function endDrag(e){
  if(!drag)return;const d=drag;drag=null;
  if(e.type==='pointercancel'){UI.selMonths=d.prev;paintSel(UI.selMonths);return}
  const m=d.R.months[d.a];
  if(!d.moved&&d.a===d.b&&d.prev&&d.prev[0]===m&&d.prev[1]===m)UI.selMonths=null;
  else UI.selMonths=[d.R.months[Math.min(d.a,d.b)],d.R.months[Math.max(d.a,d.b)]];
  paintSel(UI.selMonths);
}
document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
function hbars(items,{max,empty='Nothing here yet.',cls=''}={}){
  if(!items.length)return `<p class="muted" style="margin:0">${empty}</p>`;
  const mx=max||Math.max(...items.map(i=>i.value),1);
  return `<div class="hbars ${cls}">${items.map(i=>`<div class="hb" ${i.tip!=null?`data-tip="${i.tip}"`:''}><div class="n"><span class="name">${esc(i.name)}</span>${i.sub?`<small>${esc(i.sub)}</small>`:''}</div><div class="v">${i.valueText||mAuto(i.value)}</div><div class="track"><div class="fill" style="width:${Math.max(1.5,i.value/mx*100).toFixed(1)}%;background:${i.color}"></div></div></div>`).join('')}</div>`;
}
const legendKeys=series=>`<div class="series-legend">${series.map(s=>`<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;

// ================= Views =================
const IC={
  pie:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 2a6 6 0 1 0 6 6H8z"/><path d="M10 1.5v4.5h4.5A4.5 4.5 0 0 0 10 1.5z"/></svg>',
  cal:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5.5 1.5v3M10.5 1.5v3"/></svg>',
  pin:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 14.5s5-4.3 5-8.2A5 5 0 0 0 3 6.3c0 3.9 5 8.2 5 8.2z"/><circle cx="8" cy="6.3" r="1.8"/></svg>',
  up:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12l4-4 3 3 5-6"/><path d="M10 5h4v4"/></svg>',
  coin:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="6"/><path d="M8 4.5v7M10 6.2c-.4-.6-1.1-.9-2-.9-1.1 0-2 .6-2 1.4 0 1.9 4 1 4 2.8 0 .8-.9 1.4-2 1.4-.9 0-1.7-.4-2-1"/></svg>',
  bag:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 5h10l-1 9H4z"/><path d="M6 5V4a2 2 0 0 1 4 0v1"/></svg>',
  flame:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 14.5c2.8 0 4.5-1.9 4.5-4.4 0-2.9-2.4-4.4-3.2-7.6-1.4 1.3-2.1 2.9-2 4.4-.8-.5-1.3-1.3-1.5-2.2C4.4 6 3.5 7.6 3.5 10.1c0 2.5 1.7 4.4 4.5 4.4z"/></svg>',
  spark:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.3 2.3M10.3 10.3l2.3 2.3M12.6 3.4l-2.3 2.3M5.7 10.3l-2.3 2.3"/></svg>',
  target:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r=".6" fill="currentColor"/></svg>',
  stack:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 5.5L8 2.5l6 3-6 3z"/><path d="M2 8.5l6 3 6-3M2 11.5l6 3 6-3"/></svg>',
  car:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.5 11V8l1.5-4h8l1.5 4v3z"/><circle cx="5" cy="11.5" r="1.3"/><circle cx="11" cy="11.5" r="1.3"/></svg>',
};
let renderQueued=false,pendingRender=false;
function requestRender(){if(document.activeElement&&document.activeElement.matches('#main input')){pendingRender=true;return}if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;render()})}
document.addEventListener('focusout',e=>{if(pendingRender&&e.target.matches&&e.target.matches('#main input')){pendingRender=false;setTimeout(requestRender,0)}});

function render(){
  TIPS.length=0;
  const main=$('#main');
  if(UI.lock){
    ['#rangeSel','#acctSel','#addBtn','#lockBtn','#helpBtn','#tabs'].forEach(s=>{const e=$(s);if(e)e.hidden=true});
    if(UI.lock==='guide'){$('#lockBtn').hidden=false;main.innerHTML=guideView();window.scrollTo(0,0);return}
    main.innerHTML=UI.lock==='import'?importView():lockView();
    const f=$('#pass1')||$('#impPass');if(f)setTimeout(()=>f.focus(),30);
    return;
  }
  $('#addBtn').hidden=false;$('#lockBtn').hidden=false;$('#helpBtn').hidden=false;
  const T=allTxns();
  const hasData=Object.keys(stmts()).length>0;
  // controls
  const ms=monthsPresent(T);
  const accts=[...new Set(Object.values(stmts()).map(s=>s.account||'Account'))].sort();
  if(UI.acct!=='all'&&!accts.includes(UI.acct))UI.acct='all';
  const rs=$('#rangeSel');
  const opts=[['all','All time'],['3m','Last 3 months'],['6m','Last 6 months'],['12m','Last 12 months'],['ytd','This year']];
  if(!['all','3m','6m','12m','ytd'].includes(UI.range)&&!ms.includes(UI.range))UI.range='all';
  rs.innerHTML=opts.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')+(ms.length?`<optgroup label="Month">${[...ms].reverse().map(m=>`<option value="${m}">${mLabel(m,true)}</option>`).join('')}</optgroup>`:'');
  rs.value=UI.range;
  const as=$('#acctSel');as.innerHTML=`<option value="all">All accounts</option>`+accts.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');as.value=UI.acct;
  rs.hidden=as.hidden=!hasData;as.hidden=!hasData||accts.length<2;
  $('#tabs').hidden=!hasData;
  document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',t.dataset.v===UI.view));
  $('#stCount').textContent=hasData?Object.keys(stmts()).length:'';
  if(S.mode==='loading'&&!hasData){main.innerHTML=`<div class="card" style="padding:40px;text-align:center"><div class="spin" style="margin:0 auto 12px"></div><p class="muted" style="margin:0">Loading your statements…</p></div>`;return}
  if(!hasData){main.innerHTML=emptyView();bindDrops();return}
  const b=rangeBounds(T);const F=filterT(T,b);
  $('#txCount').textContent=F.length;
  let html=S.example?`<div class="banner"><span><b>Example data.</b> These numbers are made up so you can look around. Add your own statements to replace them.</span><button class="btn" data-act="clear-example">Clear example</button></div>`:'';
  if(UI.view!=='statements'&&!S.example){const oT=F.filter(t=>t.cat==='Other'&&t.kind==='spend'&&!t.u);const ov=oT.reduce((s,t)=>s+t.a,0);const sv=F.filter(t=>t.kind==='spend').reduce((s,t)=>s+t.a,0);
    if(oT.length&&ov>Math.max(50,sv*.03))html+=`<div class="banner warn"><span><b>${mAuto(ov)}</b> across ${oT.length} transactions is still in <b>Other</b>.${sampleFn?' Claude can take a closer look and sort them.':' Give them a category in Transactions and Spend It remembers it.'}</span>${sampleFn?`<button class="btn" data-act="sort-other" ${UI.sorting?'disabled':''}>${UI.sorting?'Sorting…':'Sort “Other” with Claude'}</button>`:`<button class="btn" data-act="show-other">Review in Transactions</button>`}</div>`}
  html+=({overview:overviewView,transactions:txView,recurring:recurringView,statements:statementsView}[UI.view]||overviewView)(T,F,b);
  main.innerHTML=html;
  if(document.querySelector('[data-brush-sum]'))paintSel(UI.selMonths);
  if(UI.view==='transactions')renderTxTable(F);
  fillBoardText();
  if(UI.view==='statements')bindDrops();
}

function emptyView(){
  return `<section class="card empty">
    <div>
      <div class="eyebrow">Spending dashboard</div>
      <h2>See where your money actually goes</h2>
      <p class="lede">Drop in your bank and credit card statements. Spend It pulls out every transaction, sorts it into categories, and shows your spending habits month by month.</p>
      <ol class="steps">
        <li><span class="n">1</span><span><b>Upload statements.</b> PDF statements, Venmo CSV statements, or CSV and Excel exports from any bank. Add as many months as you have.</span></li>
        <li><span class="n">2</span><span><b>Spend It sorts them.</b> Each purchase gets a clean merchant name and a category, and totals are checked against the statement.</span></li>
        <li><span class="n">3</span><span><b>Explore your habits.</b> Category breakdowns, monthly trends, recurring charges and projected savings. Fix any category and Spend It remembers it.</span></li>
      </ol>
      <button class="btn ghost" data-act="example">See it with example data</button>
    </div>
    <div>
      ${dropZone()}
      <p class="fine">Statements are read on your device and never uploaded anywhere. Your dashboard is encrypted with your passcode and saved only in this browser.</p>
    </div>
  </section>`;
}
function dropZone(){
  return `<div class="drop" tabindex="0" role="button" data-act="pick" aria-label="Choose statement files">
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true"><rect x="6" y="3" width="22" height="28" rx="4" stroke="var(--accent)" stroke-width="2"/><path d="M11 11h12M11 16h12M11 21h7" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/></svg>
    <h3>Drop statements here</h3><p>or click to choose files · PDF, CSV, XLSX</p></div>`;
}

function spendParts(F){return F.filter(t=>t.kind==='spend')}
function cardW(span){const mw=Math.min(1240,($('#main').clientWidth||1200))-(innerWidth<=520?32:40);const pad=innerWidth<=520?34:42;if(span===12||mw<940)return mw-pad;return (mw-16)/2-pad}
function overviewView(T,F,b){
  const SP=spendParts(F);const total=SP.reduce((s,t)=>s+t.a,0);
  const monthsData=[...new Set(SP.map(t=>t.d.slice(0,7)))];const nM=Math.max(1,monthsData.length);
  const inc=F.filter(t=>t.kind==='income').reduce((s,t)=>s-t.a,0);
  // delta vs previous month (single month) or previous equal-length window
  let deltaHtml='';
  if(b.single){const prev=addMonths(b.from,-1);const pT=filterT(T,{from:prev,to:prev}).filter(t=>t.kind==='spend');if(pT.length){const pv=pT.reduce((s,t)=>s+t.a,0);if(pv>0){const d=(total-pv)/pv*100;deltaHtml=`<span class="delta ${d>0?'up':'down'}">${d>0?'▲':'▼'} ${Math.abs(d).toFixed(0)}%</span><span>vs ${mLabel(prev)}</span>`}}}
  const gTot=GROUPS.map(g=>({g,v:SP.filter(t=>gOf(t.cat)===g).reduce((s,t)=>s+t.a,0)})).filter(x=>x.v>0.004).sort((a,b)=>b.v-a.v);
  const top=gTot[0];
  const kpis=`
    <div class="card kpi hero c6"><div class="label">Spent${b.single?' in '+mLabel(b.from,true):''}</div><div class="value">${m0(total)}</div>
      <div class="meta">${deltaHtml||`<span>${nM} month${nM>1?'s':''} · ${SP.length} purchases</span>`}</div></div>
    <div class="card kpi c3"><div class="label">${b.single?'Purchases':'Monthly average'}</div><div class="value">${b.single?SP.length:m0(total/nM)}</div><div class="meta">${b.single?`avg ${m2(SP.length?total/SP.length:0)} each`:`across ${nM} month${nM>1?'s':''}`}</div></div>
    <div class="card kpi c3">${false?`<div class="label">Income</div><div class="value">${m0(inc)}</div><div class="meta">${inc-total>=0?'Saved ':'Overspent '}${m0(Math.abs(inc-total))}</div>`:`<div class="label">Top area</div><div class="value" style="font-size:22px;margin-top:10px">${top?esc(top.g.name):'None'}</div><div class="meta">${top?`${m0(top.v)} · ${Math.round(top.v/total*100)}% of spending`:''}</div>`}</div>`;
  // donut
  const parts=gTot.map(x=>({id:x.g.id,value:x.v,color:`var(${x.g.c})`,tip:tipId(`<div class="t-h">${esc(x.g.name)}</div>${tipRow('Spent',mAuto(x.v))}${tipRow('Share',Math.round(x.v/total*100)+'%')}`)}));
  const legend=`<ul class="legend" style="--rows:${Math.ceil(gTot.length/2)}">${gTot.map(x=>`<li data-act="group" data-g="${x.g.id}" ><i class="sw" style="background:var(${x.g.c})"></i><span class="name">${esc(x.g.name)}</span><span class="amt">${mAuto(x.v)}</span><span class="pct">${(x.v/total*100).toFixed(0)}%</span></li>`).join('')}</ul>`;
  // categories
  const selG=UI.group&&GROUPS.find(g=>g.id===UI.group);
  const catMap=sumBy(SP.filter(t=>!selG||gOf(t.cat)===selG),t=>t.cat);
  const cats=[...catMap].filter(([,v])=>v>0.004).sort((a,b)=>b[1]-a[1]).slice(0,selG?12:10);
  const catItems=cats.map(([c,v])=>{const n=SP.filter(t=>t.cat===c).length;return {name:c,value:v,color:colorOf(c),sub:`${n} txn${n>1?'s':''}`,tip:tipId(`<div class="t-h">${esc(c)}</div>${tipRow('Spent',mAuto(v))}${tipRow('Per month',m0(v/nM))}${tipRow('Transactions',n)}`)}});
  // merchants
  const mm=new Map();for(const t of SP){const k=t.m;const o=mm.get(k)||{v:0,n:0,cat:t.cat};o.v+=t.a;o.n++;mm.set(k,o)}
  const merch=[...mm].filter(([,o])=>o.n>0).sort((a,b)=>b[1].n-a[1].n||b[1].v-a[1].v).slice(0,10).map(([m,o])=>({name:m,value:o.n,valueText:`${o.n} visit${o.n>1?'s':''}`,color:colorOf(o.cat),sub:mAuto(o.v),tip:tipId(`<div class="t-h">${esc(m)}</div>${tipRow(o.cat,mAuto(o.v),colorOf(o.cat))}${tipRow('Visits',o.n)}${tipRow('Average',m2(o.v/o.n))}`)}));
  // monthly stacked
  const span=b.single?monthSpan(addMonths(b.from,-5)<(monthsPresent(T)[0])?monthsPresent(T)[0]:addMonths(b.from,-5),b.from):monthSpan(b.from,b.to);
  const TA=filterT(T,null).filter(t=>t.kind==='spend');
  const mg={};for(const t of TA){const k=t.d.slice(0,7);const g=gOf(t.cat);if(!g)continue;(mg[k]=mg[k]||{})[g.id]=(mg[k][g.id]||0)+t.a}
  const gSeries=GROUPS.map(g=>({name:g.name,color:`var(${g.c})`,values:span.map(m=>(mg[m]||{})[g.id]||0)})).filter(s=>s.values.some(v=>v>0));
  const gTips=span.map((m,i)=>{const rows=gSeries.map(s=>[s,s.values[i]]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);const tt=rows.reduce((s,x)=>s+x[1],0);return tipId(`<div class="t-h">${mLabel(m,true)} · ${mAuto(tt)}</div>${rows.map(([s,v])=>tipRow(s.name,mAuto(v),s.color)).join('')}`)});
  const NEEDS=new Set(['Gas & EV Charging','Rideshare & Taxi','Public Transit','Parking & Tolls','Auto & Maintenance','Rent & Housing','Utilities','Phone & Internet','Insurance','Fees & Interest','Pharmacy & Health','Personal Care','Fitness','Education','Charity & Giving']);
  const FOODC=new Set(['Restaurants','Fast Food','Food Delivery','Coffee, Tea & Drinks','Desserts & Bakery','Groceries']);
  const needOf=t=>FOODC.has(t.cat)?'food':NEEDS.has(t.cat)?'need':'fun';
  const nfM={};for(const t of TA){const k=t.d.slice(0,7);(nfM[k]=nfM[k]||{need:0,food:0,fun:0})[needOf(t)]+=t.a}
  const series=[{id:'need',name:'Necessities',color:'var(--s1)'},{id:'food',name:'Food',color:'var(--s3)'},{id:'fun',name:'Fun',color:'var(--s2)'}].map(s=>({...s,values:span.map(m=>Math.max(0,(nfM[m]||{})[s.id]||0))}));
  const nfTop=(m,kind)=>{const r=[...sumBy(TA.filter(t=>t.d.slice(0,7)===m&&needOf(t)===kind),t=>t.cat)].filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,3);return r.map(([c,v])=>`<div class="t-r" style="padding-left:15px;font-size:12px"><span>${esc(c)}</span><span>${mAuto(v)}</span></div>`).join('')};
  const colTips0=span.map((m,i)=>{const rows=series.map(s=>[s,s.values[i]]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);const tt=rows.reduce((s,x)=>s+x[1],0);return tipId(`<div class="t-h">${mLabel(m,true)} · ${mAuto(tt)}</div>${rows.map(([s,v])=>tipRow(s.name,mAuto(v),s.color)).join('')}`)});
  const colTips=span.map((m,i)=>{const vs=series.map(s=>s.values[i]),tt=vs.reduce((a,v)=>a+v,0)||1;return tipId(`<div class="t-h">${mLabel(m,true)} · ${mAuto(vs.reduce((a,v)=>a+v,0))}</div>${[...series].reverse().map((s,j)=>{const v=s.values[i];return tipRow(s.name+' · '+Math.round(v/tt*100)+'%',mAuto(v),s.color)+nfTop(m,s.id)}).join('')}`)});
  const avgM=span.length?span.reduce((s,m,i)=>s+series.reduce((a,se)=>a+se.values[i],0),0)/span.length:0;
  const multiY=span.some(x=>x.slice(0,4)!==span[0].slice(0,4));
  BR.month={months:span,series:gSeries,top:4};BR.nf={months:span,series:[...series].reverse(),top:3};
  const monthly=columns({labels:span.map((m,i)=>mLabel(m)+(multiY&&(i===0||m.endsWith('-01'))?" '"+m.slice(2,4):'')),series,colTips,highlight:b.single?span.indexOf(b.from):null,W:cardW(12),brush:span.length>1?'nf':null});
  // weekday
  const wd=[0,0,0,0,0,0,0],wn=[0,0,0,0,0,0,0];for(const t of SP){const d=dow(t.d);wd[d]+=t.a;wn[d]++}
  const order=[1,2,3,4,5,6,0];
  const wdTips=order.map(d=>tipId(`<div class="t-h">${['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'][d]}</div>${tipRow('Spent',mAuto(wd[d]))}${tipRow('Purchases',wn[d])}${tipRow('Avg purchase',m2(wn[d]?wd[d]/wn[d]:0))}`));
  const maxD=order.reduce((a,d)=>wd[d]>wd[a]?d:a,1);
  const weekday=w=>columns({labels:order.map(d=>DAYS[d]),series:[{name:'Spent',color:'var(--accent)',values:order.map(d=>wd[d])}],stacked:false,colTips:wdTips,height:250,W:w});
  // ride & delivery apps
  const APPS=[['Uber rides','--s1'],['Uber Eats','--s2'],['DoorDash','--s3'],['Lyft','--s4'],['Grubhub','--s5'],['Other delivery','--s6'],['Taxis & other rides','--s7']];
  const appOf=t=>{const s=(t.m+' '+t.r).toLowerCase();if(/uber\s*\*?\s*eats/.test(s)||(/uber/.test(s)&&t.cat==='Food Delivery'))return 'Uber Eats';if(/uber/.test(s))return 'Uber rides';if(/doordash/.test(s))return 'DoorDash';if(/lyft/.test(s))return 'Lyft';if(/grubhub/.test(s))return 'Grubhub';if(t.cat==='Food Delivery')return 'Other delivery';if(t.cat==='Rideshare & Taxi')return 'Taxis & other rides';return null};
  const appAgg={};for(const t of SP){const a=appOf(t);if(!a)continue;const o=appAgg[a]=appAgg[a]||{v:0,n:0};o.v+=t.a;o.n++}
  const appRows=APPS.filter(([n])=>appAgg[n]&&appAgg[n].v>0).map(([n,c])=>({name:n,c:`var(${c})`,v:appAgg[n].v,k:appAgg[n].n}));
  const appTot=appRows.reduce((s,x)=>s+x.v,0),appN=appRows.reduce((s,x)=>s+x.k,0);
  const appParts=appRows.map(x=>({id:'app'+x.name.replace(/\W/g,''),value:x.v,color:x.c,tip:tipId(`<div class="t-h">${esc(x.name)}</div>${tipRow('Spent',mAuto(x.v))}${tipRow('Times used',x.k)}${tipRow('Average',m2(x.v/x.k))}`)}));
  const appsCard=appRows.length?`<section class="card c6"><div class="card-h"><h2>Uber & delivery apps</h2><span class="sub">${appN} rides and orders${nM>1?` · ${m0(appTot/nM)} a month`:''}</span></div>
    <div class="donut-wrap">${donut(appParts,appTot,'on apps')}<ul class="legend">${appRows.map(x=>`<li style="cursor:default"><i class="sw" style="background:${x.c}"></i><span class="name">${esc(x.name)} <span class="muted" style="font-size:12.5px">×${x.k}</span></span><span class="amt">${mAuto(x.v)}</span><span class="pct">${Math.round(x.v/appTot*100)}%</span></li>`).join('')}</ul></div></section>`:'';
  // food breakdown
  const FOODS=[['Restaurants','--s1',['Restaurants']],['Fast food','--s2',['Fast Food']],['Delivery','--s3',['Food Delivery']],['Groceries','--s4',['Groceries']],['Drinks','--s5',['Coffee, Tea & Drinks']],['Desserts','--s6',['Desserts & Bakery']],['Bars & alcohol','--s8',['Bars & Nightlife','Liquor & Wine']]];
  const foodRows=FOODS.map(([n,c,cs])=>{const tt=SP.filter(t=>cs.includes(t.cat));return {name:n,c:`var(${c})`,v:tt.reduce((s,t)=>s+t.a,0),k:tt.length}}).filter(x=>x.v>0);
  const foodTot=foodRows.reduce((s,x)=>s+x.v,0);
  const FOOD2=[['Restaurants','--s1',['Restaurants','Food Delivery']],['Fast food','--s2',['Fast Food']],['Groceries','--s4',['Groceries']]];
  const foodSeries=FOOD2.map(([n,c,cs])=>({name:n,color:`var(${c})`,cs,values:span.map(m=>TA.filter(t=>t.d.slice(0,7)===m&&cs.includes(t.cat)).reduce((s,t)=>s+t.a,0))})).filter(s=>s.values.some(v=>v>0));
  const foodTips=span.map((m,i)=>{const rows=foodSeries.map(s=>[s,s.values[i]]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);const tt=rows.reduce((s,x)=>s+x[1],0);return tipId(`<div class="t-h">${mLabel(m,true)} · ${mAuto(tt)}</div>${rows.map(([s,v])=>tipRow(s.name+' · '+Math.round(v/tt*100)+'%',mAuto(v),s.color)).join('')}`)});
  BR.food={months:span,series:foodSeries,top:3};
  const foodAvg0=span.length?foodSeries.reduce((s,se)=>s+se.values.reduce((a,v)=>a+v,0),0)/span.length:0;
  const foodCard=foodRows.length?`<section class="card c12"><div class="card-h"><h2>Restaurants vs fast food vs groceries</h2><span class="sub" style="display:flex;gap:14px;flex-wrap:wrap">${foodSeries.map(s=>`<span style="display:inline-flex;align-items:center;gap:6px"><i class="sw" style="background:${s.color}"></i>${esc(s.name)} <b style="color:var(--ink)">${m0(s.values.reduce((a,v)=>a+v,0)/Math.max(1,span.length))}</b>/mo avg</span>`).join('')}</span></div>
    ${span.length>1?'<div class="brush-sum" data-brush-sum="food"></div>':''}${columns({labels:span.map((m,i)=>mLabel(m)+(multiY&&(i===0||m.endsWith('-01'))?" '"+m.slice(2,4):'')),series:foodSeries,stacked:false,colTips:foodTips,highlight:b.single?span.indexOf(b.from):null,W:cardW(12),brush:span.length>1?'food':null})}
    ${(()=>{const tots=foodSeries.map(s=>s.values.reduce((a,v)=>a+v,0));const tt=tots.reduce((a,v)=>a+v,0)||1;return `<div class="series-legend">${foodSeries.map((s,i)=>`<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)} <b>${Math.round(tots[i]/tt*100)}%</b> · ${m0(tots[i])}</span>`).join('')}<span class="muted">Restaurants include delivery</span></div>`})()}</section>`:'';
  // largest
  const big=[...SP].sort((a,b)=>b.a-a.a).slice(0,6);
  const bigHtml=`<table class="big"><tbody>${big.map(t=>`<tr><td class="date">${dLabel(t.d)}</td><td><div class="merch"><span class="name">${esc(t.m)}</span><span class="raw">${esc(t.cat)}</span></div></td><td class="amt">${m2(t.a)}</td></tr>`).join('')}</tbody></table>`;
  // cash flow
  let cash='';
  if(false){
    const ci=span.map(m=>filterT(T,{from:m,to:m}).filter(t=>t.kind==='income').reduce((s,t)=>s-t.a,0));
    const cs=span.map(m=>filterT(T,{from:m,to:m}).filter(t=>t.kind==='spend').reduce((s,t)=>s+t.a,0));
    const se=[{name:'Income',color:'var(--s3)',values:ci},{name:'Spending',color:'var(--s2)',values:cs}];
    const tips=span.map((m,i)=>tipId(`<div class="t-h">${mLabel(m,true)}</div>${tipRow('Income',mAuto(ci[i]),'var(--s3)')}${tipRow('Spending',mAuto(cs[i]),'var(--s2)')}${tipRow(ci[i]-cs[i]>=0?'Saved':'Overspent',mAuto(Math.abs(ci[i]-cs[i])))}`));
    cash=`<section class="card c12"><div class="card-h"><h2>Cash flow</h2><span class="sub">Income vs spending by month</span></div>${columns({labels:span.map(m=>mLabel(m)),series:se,stacked:false,colTips:tips,height:220,W:cardW(12)})}${legendKeys(se)}</section>`;
  }
  return `<div class="grid">${whoHtml(SP,total,nM,b)}${kpis}
    <section class="card c12"><div class="card-h"><h2>Where it went</h2><span class="sub">Tap a group to see its transactions</span></div>
      <div class="donut-wrap">${donut(parts,total,'spent')}${legend}</div></section>
    ${storyHtml(SP,total,nM,b)}
    <section class="card c12"><div class="card-h"><h2>Your habits</h2><span class="sub">Patterns in how you spend</span></div>${insightsHtml(T,F,SP,total,nM,b)}</section>
    <section class="card c12"><div class="card-h"><h2>Spending by month</h2><span class="sub" style="display:flex;gap:6px 14px;flex-wrap:wrap;justify-content:flex-end">${[...gSeries].map(s=>({s,t:s.values.reduce((a,v)=>a+v,0)})).sort((x,y)=>y.t-x.t).slice(0,4).map(({s,t})=>`<span style="display:inline-flex;align-items:center;gap:6px"><i class="sw" style="background:${s.color}"></i>${esc(s.name)} <b style="color:var(--ink)">${m0(t/Math.max(1,span.length))}</b>/mo avg</span>`).join('')}</span></div>${span.length>1?'<div class="brush-sum" data-brush-sum="month"></div>':''}${columns({labels:span.map((m,i)=>mLabel(m)+(multiY&&(i===0||m.endsWith('-01'))?" '"+m.slice(2,4):'')),series:gSeries,colTips:gTips,highlight:b.single?span.indexOf(b.from):null,W:cardW(12),brush:span.length>1?'month':null})}<div class="series-legend">${gSeries.map(s=>`<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}<span class="muted">Total average ${m0(gSeries.reduce((s,se)=>s+se.values.reduce((a,v)=>a+v,0),0)/Math.max(1,span.length))} a month</span></div></section>
    <section class="card c12"><div class="card-h"><h2>Fun vs food vs necessities</h2><span class="sub" style="display:flex;gap:14px;flex-wrap:wrap">${[...series].reverse().map(s=>`<span style="display:inline-flex;align-items:center;gap:6px"><i class="sw" style="background:${s.color}"></i>${esc(s.name)} <b style="color:var(--ink)">${m0(s.values.reduce((a,v)=>a+v,0)/Math.max(1,span.length))}</b>/mo avg</span>`).join('')}</span></div>${span.length>1?'<div class="brush-sum" data-brush-sum="nf"></div>':''}${monthly}
      ${(()=>{const tot=series.map(s=>s.values.reduce((a,v)=>a+v,0)),tt=tot.reduce((a,v)=>a+v,0)||1;return `<div class="series-legend">${[...series].reverse().map((s,j)=>{const i=series.length-1-j;return `<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)} <b>${Math.round(tot[i]/tt*100)}%</b> · ${m0(tot[i])}</span>`}).join('')}<span class="muted">Food: restaurants, fast food, delivery, drinks, desserts and groceries. Necessities: gas, rides, parking, bills, health, personal care and giving. Fun: everything else, including bars.</span></div>`})()}</section>
    ${lifeHtml(SP,nM,needOf,b)}
    ${goalHtml()}
    ${foodCard}${appsCard}
    <section class="card ${appsCard?'c6':'c12'}"><div class="card-h"><h2>Top merchants</h2><span class="sub">By times visited</span></div>${hbars(merch)}</section>
    ${debtHtml()}
  </div>`;
}
function taxCA(g){const br=(ti,b)=>{let t=0,p=0;for(const [top,r] of b){if(ti>p)t+=(Math.min(ti,top)-p)*r;p=top}return t};
  const fed=br(Math.max(0,g-15750),[[11925,.10],[48475,.12],[103350,.22],[197300,.24],[250525,.32],[626350,.35],[1e12,.37]]);
  const ca=Math.max(0,br(Math.max(0,g-5540),[[10756,.01],[25499,.02],[40245,.04],[55866,.06],[70606,.08],[360659,.093],[432787,.103],[721314,.113],[1e12,.123]])-149);
  return fed+ca+Math.min(g,176100)*.062+g*.0145+g*.012}
function grossFor(net){let lo=0,hi=5e6;for(let i=0;i<60;i++){const m=(lo+hi)/2;if(m-taxCA(m)<net)lo=m;else hi=m}return hi}
let LIFE=null;
function lifeHtml(SP,nM,needOf,b){
  if(!SP.length)return '';
  const rent=+((S.meta&&S.meta.rent)??2000)||0,save=+((S.meta&&S.meta.saveAmt)??500)||0;
  const per=v=>v/(b.single?1:nM);
  const sum=f=>per(SP.filter(f).reduce((s,t)=>s+t.a,0));
  const inC=(...c)=>t=>c.includes(t.cat),inG=id=>t=>gOf(t.cat)&&gOf(t.cat).id===id;
  const need=sum(t=>needOf(t)==='need'),groc=sum(inC('Groceries'));
  const eatOut=sum(inC('Restaurants','Fast Food','Food Delivery','Coffee, Tea & Drinks','Desserts & Bakery'));
  const travel=sum(inG('travel')),night=sum(inG('alcohol')),fun=sum(inG('fun')),shop=sum(inG('shop'));
  const all=sum(()=>true);const otherFun=Math.max(0,all-need-groc-eatOut-travel-night-fun-shop);
  LIFE={rent,save,need,groc,eatOut,travel,night,fun,shop,otherFun,all};
  const box=(id,label,val)=>`<label class="rent-in"><span>${label}</span><span class="money-in"><span>$</span><input id="${id}" inputmode="decimal" value="${val}" aria-label="Monthly ${label.toLowerCase()}"></span><span class="muted">/mo</span></label>`;
  return `<section class="card c12 life"><div class="card-h"><h2>Bare minimum vs good life</h2>
      <div class="life-ins">${box('rentIn','Rent',rent)}${box('saveIn','Savings',save)}</div></div>
    <div class="life-grid">
      <div class="life-col"><div class="st-h">Bare minimum</div>${lifeCol('bare')}</div>
      <div class="life-col"><div class="st-h">Your good life</div>${lifeCol('good')}</div>
    </div>
    <p class="life-note">${lifeNote()}</p></section>`;
}
function lifeParts(){
  const L=LIFE;const base=[['Rent','var(--s0)',L.rent],...(L.save>0?[['Savings','var(--accent)',L.save]]:[]),['Necessities','var(--s1)',L.need],['Groceries','var(--s4)',L.groc]];
  const good=[...base,['Eating out & drinks','var(--s3)',L.eatOut],['Travel','var(--s5)',L.travel],['Nights out','var(--s8)',L.night],['Events & fun','var(--s7)',L.fun],['Shopping','var(--s2)',L.shop],['Everything else','var(--s6)',L.otherFun]].filter(x=>x[2]>0.5);
  const spend=L.rent+L.need+L.groc;
  return {bare:base,good,bareTot:spend+L.save,goodTot:L.rent+L.all+L.save,spend,life:L.rent+L.all};
}
function lifeCol(which){
  const P=lifeParts();const parts=P[which],total=P[which+'Tot'],max=Math.max(P.bareTot,P.goodTot);const sv=LIFE.save;
  const sub=which==='bare'?`Rent, necessities and groceries${sv>0?', plus your savings':''}. Everything you need to get by.`:`What you actually spend now, plus rent${sv>0?' and savings':''}.`;
  return `<div class="life-num">${m0(total)}<span>/mo</span></div><div class="life-sub">${sub}</div>
    <div class="life-bar">${parts.map(([n,c,v])=>`<i style="width:${(v/max*100).toFixed(2)}%;background:${c}" data-tip="${tipId(`<div class="t-h">${esc(n)}</div>${tipRow('Per month',m0(v))}${tipRow('Per year',m0(v*12))}`)}"></i>`).join('')}</div>
    <ul class="life-legend">${parts.map(([n,c,v])=>`<li><i class="sw" style="background:${c}"></i><span>${esc(n)}</span><b>${m0(v)}</b></li>`).join('')}</ul>
    <div class="life-inc"><span>Income needed before taxes</span><b>${m0(grossFor(total*12))}/yr</b></div>`;
}
function lifeNote(){
  const P=lifeParts();const gap=P.goodTot-P.bareTot;
  const drivers=P.good.filter(x=>!['Rent','Savings','Necessities','Groceries'].includes(x[0])).sort((a,b)=>b[2]-a[2]).slice(0,3).map(x=>`${x[0].toLowerCase()} (${m0(x[2])})`);
  return `Your lifestyle costs <b>${m0(gap)} a month</b> (${m0(gap*12)} a year) more than the bare minimum${drivers.length?`, mostly ${drivers.length>1?drivers.slice(0,-1).join(', ')+' and '+drivers[drivers.length-1]:drivers[0]}`:''}.${LIFE.save>0?` Both include saving ${m0(LIFE.save)} a month (${m0(LIFE.save*12)} a year).`:''} Income estimates assume a single filer in California using 2025 tax rates; they’re a ballpark, not tax advice.`;
}
const US_ST=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'.split(' '));
const COUNTRY={JP:'Japan',KR:'South Korea',MX:'Mexico',GB:'the UK',FR:'France',IT:'Italy',ES:'Spain',DE:'Germany',CA:'Canada',TH:'Thailand',VN:'Vietnam',PH:'the Philippines',TW:'Taiwan',HK:'Hong Kong',SG:'Singapore',CN:'China',AU:'Australia',NL:'the Netherlands',PT:'Portugal',GR:'Greece',ID:'Indonesia'};
const VAL_EMO={'Experiences over things':'🎟️','Seeing the world':'🌏','Time with friends':'🥂','Convenience and your time':'⏱️','Little daily treats':'🧋','Music and live events':'🎶','Giving back':'🙏','Staying active':'🧗','Looking good':'✨'};
document.addEventListener('submit',e=>{if(e.target.id!=='nameForm')return;e.preventDefault();const v=$('#nameIn').value.trim().slice(0,30);S.meta={...S.meta,name:v};UI.editName=false;if(!S.example)saveMeta();if(document.activeElement)document.activeElement.blur();pendingRender=false;requestRender()});
// ---- Zodiac buddies (original full-body drawings) ----
const ZOD=(()=>{
  const K='#2b2420';
  const mir=s=>`<g>${s}</g><g transform="translate(120 0) scale(-1 1)">${s}</g>`;
  const eyes=(y=54,dx=11)=>`<ellipse cx="${60-dx}" cy="${y}" rx="2.7" ry="3.3" fill="${K}"/><ellipse cx="${60+dx}" cy="${y}" rx="2.7" ry="3.3" fill="${K}"/><circle cx="${60-dx+.9}" cy="${y-1.2}" r=".9" fill="#fff"/><circle cx="${60+dx+.9}" cy="${y-1.2}" r=".9" fill="#fff"/>`;
  const blush=(y=60,dx=18,c='#ff8fa3')=>`<ellipse cx="${60-dx}" cy="${y}" rx="4.6" ry="2.8" fill="${c}" opacity=".55"/><ellipse cx="${60+dx}" cy="${y}" rx="4.6" ry="2.8" fill="${c}" opacity=".55"/>`;
  const w=(y=60)=>`<path d="M56 ${y} q2 2.4 4 0 q2 2.4 4 0" fill="none" stroke="${K}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  // body: sitting pear + arms + feet; head on top
  const body=(c,belly,paw,foot)=>`<ellipse cx="49" cy="107" rx="8.5" ry="4.6" fill="${foot||paw||c}"/><ellipse cx="71" cy="107" rx="8.5" ry="4.6" fill="${foot||paw||c}"/><ellipse cx="60" cy="90" rx="23" ry="19" fill="${c}"/>${belly?`<ellipse cx="60" cy="94" rx="13" ry="12" fill="${belly}"/>`:''}<ellipse cx="45" cy="92" rx="5" ry="7.5" fill="${paw||c}" transform="rotate(12 45 92)"/><ellipse cx="75" cy="92" rx="5" ry="7.5" fill="${paw||c}" transform="rotate(-12 75 92)"/>`;
  const head=(c,st)=>`<ellipse cx="60" cy="53" rx="30" ry="25" fill="${c}"${st?` stroke="${st}" stroke-width="2"`:''}/>`;
  const A=[
    ['Rat',`<path d="M80 100 q22 4 22 -12 q0 -10 -9 -8" fill="none" stroke="#7d7380" stroke-width="3" stroke-linecap="round"/>${body('#b3a9b6','#e4dce6','#f2b6c3')}${mir('<circle cx="36" cy="32" r="13" fill="#b3a9b6"/><circle cx="36" cy="32" r="7.5" fill="#f2b6c3"/>')}${head('#b3a9b6')}${eyes(54,12)}${blush(61,19)}<ellipse cx="60" cy="58.5" rx="2.8" ry="2" fill="#e57d95"/>${w(61)}${mir('<path d="M42 59 L31 57 M42 62 L32 63" stroke="#8a8090" stroke-width="1.3" stroke-linecap="round"/>')}`],
    ['Ox',`<path d="M82 98 q14 2 14 -10" fill="none" stroke="#7a5640" stroke-width="3.5" stroke-linecap="round"/><circle cx="96" cy="86" r="4" fill="#5a3e2d"/>${body('#9c7258','#e9d4bd',null,'#5a3e2d')}${mir('<path d="M40 36 Q26 30 28 14 Q34 26 46 30 Z" fill="#f4e6c8"/><ellipse cx="29" cy="48" rx="9" ry="5" fill="#86604a" transform="rotate(-20 29 48)"/>')}${head('#9c7258')}<path d="M53 29 q3.5 -6 7 0 q3.5 -6 7 0" fill="#6e4a36"/>${eyes(50,12)}${blush(56,20)}<ellipse cx="60" cy="64" rx="17" ry="10" fill="#e9d4bd"/><ellipse cx="54" cy="63" rx="2" ry="2.8" fill="#6b4a33"/><ellipse cx="66" cy="63" rx="2" ry="2.8" fill="#6b4a33"/><path d="M56 69 q4 3 8 0" fill="none" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/>`],
    ['Tiger',`<path d="M80 100 q20 2 18 -16 q-1 -6 -6 -6" fill="none" stroke="#f39a3b" stroke-width="6" stroke-linecap="round"/><path d="M93 92 l5 -2 M95 85 l5 1" stroke="#3a2a20" stroke-width="2.4" stroke-linecap="round"/>${body('#f6a144','#fff5e8')}<path d="M40 82 l6 2 M80 82 l-6 2 M42 88 l5 1 M78 88 l-5 1" stroke="#3a2a20" stroke-width="2.4" stroke-linecap="round"/>${mir('<circle cx="37" cy="33" r="9" fill="#f6a144"/><circle cx="37" cy="33" r="4.5" fill="#fff1e0"/>')}${head('#f6a144')}<path d="M60 29 v7 M52 30 q2 4 0 8 M68 30 q-2 4 0 8" stroke="#3a2a20" stroke-width="2.4" stroke-linecap="round" fill="none"/>${mir('<path d="M31 50 h7 M32 56 h6" stroke="#3a2a20" stroke-width="2.4" stroke-linecap="round"/>')}<ellipse cx="54.5" cy="61" rx="7" ry="5.5" fill="#fff5e8"/><ellipse cx="65.5" cy="61" rx="7" ry="5.5" fill="#fff5e8"/>${eyes(52,12)}${blush(59,20)}<path d="M57.5 57 h5 l-2.5 2.6z" fill="#e8657a"/>${w(61)}`],
    ['Rabbit',`<circle cx="82" cy="100" r="6" fill="#fff" stroke="#e5dccf" stroke-width="2"/>${body('#fbf8f4','#fff','#fbf8f4')}<g stroke="#e5dccf" stroke-width="2" fill="none"><ellipse cx="60" cy="90" rx="23" ry="19"/></g>${mir('<ellipse cx="48" cy="20" rx="7.5" ry="20" fill="#fbf8f4" stroke="#e5dccf" stroke-width="2" transform="rotate(-10 48 20)"/><ellipse cx="48" cy="22" rx="3.6" ry="13" fill="#f7b7c4" transform="rotate(-10 48 22)"/>')}${head('#fbf8f4','#e5dccf')}${eyes(54)}${blush(60)}<ellipse cx="60" cy="58" rx="2.6" ry="1.9" fill="#f08aa0"/>${w(61)}`],
    ['Dragon',`<path d="M78 102 q22 0 22 -16 q0 -10 -8 -10 q-6 0 -6 6" fill="none" stroke="#4fae79" stroke-width="7" stroke-linecap="round"/><path d="M98 80 l6 -4 l-1 7z" fill="#ef6b4f"/>${body('#5cb985','#f5d77a')}<path d="M52 86 h16 M52 92 h16 M53 98 h14" stroke="#e6c25a" stroke-width="1.6"/>${mir('<path d="M44 33 L36 10 L51 29 Z" fill="#f6c453"/><path d="M33 40 l-8 -3 l5 8z" fill="#ef6b4f"/>')}${head('#5cb985')}<path d="M53 29 l2.5 -8 l2.5 7 l2 -9 l2 9 l2.5 -7 l2.5 8 z" fill="#ef6b4f"/>${eyes(50,12)}${blush(56,20)}<ellipse cx="60" cy="64" rx="16" ry="10" fill="#a7dcbb"/><circle cx="55" cy="61.5" r="1.8" fill="#2f6b4a"/><circle cx="65" cy="61.5" r="1.8" fill="#2f6b4a"/><path d="M55 67 q5 4 10 0" fill="none" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/>${mir('<path d="M44 66 q-12 2 -14 -6" fill="none" stroke="#f6c453" stroke-width="2.4" stroke-linecap="round"/>')}`],
    ['Snake',`<ellipse cx="60" cy="104" rx="30" ry="8" fill="#5aa983"/><path d="M88 104 q10 -2 12 -8" fill="none" stroke="#5aa983" stroke-width="6" stroke-linecap="round"/><ellipse cx="60" cy="94" rx="25" ry="8" fill="#6fbf9a"/><ellipse cx="60" cy="85" rx="19" ry="7" fill="#5aa983"/><path d="M44 104 l4 -3 l4 3 l-4 3z M68 104 l4 -3 l4 3 l-4 3z M56 94 l4 -3 l4 3 l-4 3z" fill="#4c9a77"/><ellipse cx="60" cy="58" rx="27" ry="24" fill="#6fbf9a"/><path d="M55 40 l5 -5 l5 5 l-5 5z" fill="#4c9a77"/>${eyes(56,12)}${blush(63,19)}${w(64)}<path d="M60 69 v6 l-3 4 M60 75 l3 4" fill="none" stroke="#e2475b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`],
    ['Horse',`<path d="M80 92 q18 -2 18 10 q-2 8 -10 6 q6 -4 2 -8 q-4 -4 -10 -2z" fill="#5b3b2a"/>${body('#c98b5a','#f0c49f',null,'#4a3324')}${mir('<path d="M38 38 L38 12 L54 30 Z" fill="#c98b5a"/><path d="M41 32 L41 20 L50 29 Z" fill="#f0c49f"/>')}${head('#c98b5a')}<path d="M40 34 q4 -16 20 -10 q12 -6 18 8 q-8 2 -13 -1 q-12 8 -25 3z" fill="#5b3b2a"/><path d="M57.5 36 h5 l1.5 22 h-8z" fill="#fff4e6"/>${eyes(50,13)}${blush(56,21)}<ellipse cx="60" cy="65" rx="16" ry="10" fill="#f0c49f"/><ellipse cx="54.5" cy="63.5" rx="1.9" ry="2.7" fill="#6b4a33"/><ellipse cx="65.5" cy="63.5" rx="1.9" ry="2.7" fill="#6b4a33"/><path d="M56 69.5 q4 3 8 0" fill="none" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/>`],
    ['Goat',`<path d="M80 92 q10 -4 10 4" fill="none" stroke="#ddd2bf" stroke-width="5" stroke-linecap="round"/>${body('#f5efe4','#fff','#f5efe4','#8b7d6b')}<g stroke="#ddd2bf" stroke-width="2" fill="none"><ellipse cx="60" cy="90" rx="23" ry="19"/></g>${mir('<path d="M46 32 q-4 -18 -22 -14 q-6 2 -4 8" fill="none" stroke="#9b9488" stroke-width="6" stroke-linecap="round"/><ellipse cx="28" cy="54" rx="10" ry="5" fill="#efe6d6" stroke="#ddd2bf" stroke-width="2" transform="rotate(20 28 54)"/>')}${head('#f5efe4','#ddd2bf')}${eyes(53)}${blush(60)}<ellipse cx="60" cy="58" rx="3" ry="2" fill="#8b7d6b"/>${w(61)}<path d="M55 76 q5 12 10 0z" fill="#ddd2bf"/>`],
    ['Monkey',`<path d="M80 100 q20 0 18 -18 q-2 -10 -10 -6 q-4 4 2 7" fill="none" stroke="#8a5b3a" stroke-width="4" stroke-linecap="round"/>${body('#9b6a45','#f1c9a0')}${mir('<circle cx="29" cy="54" r="9" fill="#9b6a45"/><circle cx="29" cy="54" r="5" fill="#f1c9a0"/>')}${head('#9b6a45')}<circle cx="50" cy="51" r="10.5" fill="#f1c9a0"/><circle cx="70" cy="51" r="10.5" fill="#f1c9a0"/><ellipse cx="60" cy="63" rx="17" ry="11" fill="#f1c9a0"/><path d="M53 30 q7 -10 14 0 q-7 -4 -14 0z" fill="#6e4a32"/>${eyes(51,10)}${blush(60,17)}<circle cx="58" cy="59" r="1.2" fill="${K}"/><circle cx="62" cy="59" r="1.2" fill="${K}"/><path d="M54 64 q6 5 12 0" fill="none" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/>`],
    ['Rooster',`<path d="M78 92 q14 -24 26 -12 q-8 0 -10 8 q10 -8 14 2 q-8 0 -12 8z" fill="#e8473f"/><path d="M80 94 q12 -14 20 -6 q-8 2 -10 8z" fill="#f59a3e"/>${body('#fffaf0','#fff','#fffaf0','#f5b83d')}<g stroke="#ecd9a0" stroke-width="2" fill="none"><ellipse cx="60" cy="90" rx="23" ry="19"/></g><path d="M68 86 q10 2 8 12 q-8 -2 -8 -12z" fill="#f4e6c4"/><circle cx="50" cy="29" r="6.5" fill="#e8473f"/><circle cx="60" cy="25" r="8" fill="#e8473f"/><circle cx="70" cy="29" r="6.5" fill="#e8473f"/>${head('#fffaf0','#ecd9a0')}${eyes(52)}${blush(59)}<path d="M54.5 58 L65.5 58 L60 66 Z" fill="#f5b83d" stroke="#e5a22e" stroke-width="1.3" stroke-linejoin="round"/><path d="M60 66 q-4 8 0 9 q4 -1 0 -9z" fill="#e8473f"/>`],
    ['Dog',`<path d="M80 92 q14 -6 12 -18 q-1 -6 -6 -4 q-4 4 0 8 q2 6 -8 10z" fill="#e39a4e"/><path d="M86 74 q-3 3 0 6" fill="none" stroke="#fff5e8" stroke-width="3" stroke-linecap="round"/>${body('#e39a4e','#fff5e8','#fff5e8','#fff5e8')}${mir('<path d="M36 40 L36 18 L52 31 Z" fill="#e39a4e"/><path d="M39 35 L39 24 L48 31 Z" fill="#fff5e8"/>')}${head('#e39a4e')}<path d="M36 56 q8 -12 24 -6 q16 -6 24 6 q-4 18 -24 18 q-20 0 -24 -18z" fill="#fff5e8"/>${eyes(52,12)}${blush(59,19)}<ellipse cx="60" cy="58" rx="3.6" ry="2.6" fill="${K}"/>${w(61)}`],
    ['Pig',`<path d="M82 96 q6 -2 6 4 q0 4 -4 3 q-2 -2 1 -3 q3 2 5 -2" fill="none" stroke="#e98aa0" stroke-width="2.4" stroke-linecap="round"/>${body('#f8b6c3','#fcd3db','#f8b6c3','#e98aa0')}${mir('<path d="M34 40 L34 20 L52 30 Z" fill="#f08ca2"/>')}${head('#f8b6c3')}${eyes(51,13)}${blush(58,20,'#ef6f8b')}<ellipse cx="60" cy="60" rx="9.5" ry="6.5" fill="#f392a8"/><ellipse cx="56.8" cy="60" rx="1.8" ry="2.6" fill="#c5607a"/><ellipse cx="63.2" cy="60" rx="1.8" ry="2.6" fill="#c5607a"/><path d="M56 70 q4 3 8 0" fill="none" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/>`],
  ];
  const svg=(i,size=120)=>`<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${A[i][0]}"><ellipse cx="60" cy="113" rx="30" ry="3.5" fill="#000" opacity=".1"/>${A[i][1]}</svg>`;
  return {names:A.map(a=>a[0]),svg};
})();
function zodiacIdx(){
  if(S.example)return 2;
  let z=S.meta&&S.meta.zodiac;
  if(!(Number.isInteger(z)&&z>=0&&z<12)){z=Math.floor(Math.random()*12);S.meta={...S.meta,zodiac:z};setTimeout(()=>saveMeta(),0)}
  return z;
}
function whoHtml(SP,total,nM,b){
  if(!SP.length||total<=0)return '';
  const P=personaHtml(SP,total,nM),St=summaryHtml(SP,total,nM,b);
  const nm=((S.meta&&S.meta.name)||S.myName||holderFirst()||'').trim();
  const zi=zodiacIdx(),zn=ZOD.names[zi];
  const pName=P.name.replace(/^The\s+/,'');
  const nameCtl=UI.editName||!nm?`<form id="nameForm" class="name-form"><input class="pass" id="nameIn" value="${esc(nm)}" placeholder="Your first name" aria-label="Your first name" maxlength="30"><button class="btn" type="submit">Save</button></form>`:`<button class="btn ghost name-edit" data-act="name-edit" aria-label="Change your name">✎ Edit name</button>`;
  return `<section class="card c12 persona">
    <div class="p-hero">
      <div class="p-main">
        <div class="p-meta"><span class="p-chip">${b.single?mLabel(b.from,true):nM+' month'+(nM>1?'s':'')+' of statements'}</span>${nameCtl}</div>
        <h2 class="p-hello">Hi${nm?' '+esc(nm):''}, you’re ${/^[aeiou]/i.test(pName)?'an':'a'}</h2>
        <div class="p-name">${esc(pName)}</div>
        <p class="p-desc">${esc(P.desc)}</p>
        ${St.tags.length?`<div class="tags p-tags">${St.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
      </div>
      <figure class="p-pet"><div class="p-pet-disc">${ZOD.svg(zi,128)}</div><figcaption>Your spending buddy<b>The ${zn}</b></figcaption></figure>
    </div>
    ${P.vals.length?`<div class="st-h p-vh">What you value</div><ul class="p-vals">${P.vals.map(v=>`<li><span class="p-ve" aria-hidden="true">${VAL_EMO[v[1]]||'⭐'}</span><b>${esc(v[1])}</b><span>${esc(v[2])}</span></li>`).join('')}</ul>`:''}
</section>`;
}
function storyHtml(SP,total,nM,b){
  if(!SP.length||total<=0)return '';
  const St=summaryHtml(SP,total,nM,b);
  return `<section class="card c12 story"><div class="card-h"><h2>Your spending story</h2></div><p class="p-story">${St.S[0]}</p>${St.S.length>1?`<ul class="story-list">${St.S.slice(1).map(x=>`<li>${x}</li>`).join('')}</ul>`:''}</section>`;
}
function monthsTo(P,c,target,rMo){if(P>=target)return 0;if(rMo===0)return c>0?Math.ceil((target-P)/c):Infinity;const x=(target*rMo+c)/(P*rMo+c);if(P*rMo+c<=0||x<=0)return Infinity;const n=Math.log(x)/Math.log(1+rMo);return isFinite(n)&&n>0?Math.ceil(n):Infinity}
function fmtDur(n){if(!isFinite(n))return 'Never at this rate';if(n===0)return 'Already there';const y=Math.floor(n/12),m=n%12;return (y?y+' yr'+(y>1?'s':''):'')+(y&&m?' ':'')+(m?m+' mo':'')}
function goalHtml(){
  if(!LIFE)return '';
  const M=S.meta||{};const goal=+(M.goal??500000),saved=+(M.saved??0),income=+(M.income??100000),ret=+(M.ret??7);
  const take=(income-taxCA(income))/12;const rMo=Math.pow(1+ret/100,1/12)-1;
  const lp=lifeParts();
  const scen=[{name:'Your current lifestyle',color:'var(--s2)',spend:lp.life},{name:'Bare minimum',color:'var(--s1)',spend:lp.spend}].map(s=>{const c=take-s.spend;return {...s,c,n:monthsTo(saved,c,goal,rMo)}});
  const now=new Date();const when=n=>isFinite(n)?(()=>{const d=new Date(now.getFullYear(),now.getMonth()+n,1);return MONTHS[d.getMonth()]+' '+d.getFullYear()})():'';
  // chart
  const finN=scen.map(s=>s.n).filter(isFinite);const horizon=Math.min(600,Math.max(60,...(finN.length?finN:[120])))+6;
  const W=Math.max(300,cardW(12)),H=240,L=58,Rr=12,T=14,B=26,iw=W-L-Rr,ih=H-T-B;
  const bal=(s,m)=>{if(rMo===0)return saved+s.c*m;return saved*Math.pow(1+rMo,m)+s.c*(Math.pow(1+rMo,m)-1)/rMo};
  const ystep=Math.max(1,goal/4);const ymax=Math.ceil(goal*1.2/ystep)*ystep;const ticks=Math.round(ymax/ystep);const X=m=>L+iw*m/horizon,Y=v=>T+ih-Math.max(0,Math.min(v,ymax))/ymax*ih;
  let g='';for(let k=0;k<=ticks;k++){const v=ystep*k;g+=`<line class="${k?'grid-l':'base'}" x1="${L}" x2="${W-Rr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L-8}" y="${Y(v)+4}" text-anchor="end">${mk(v)}</text>`}
  const yrs=Math.ceil(horizon/12),stepY=yrs>30?10:yrs>12?5:yrs>6?2:1;for(let y=0;y<=yrs;y+=stepY){if(y*12>horizon)break;g+=`<text x="${X(y*12)}" y="${H-7}" text-anchor="middle">${now.getFullYear()+y}</text>`}
  g+=`<line x1="${L}" x2="${W-Rr}" y1="${Y(goal)}" y2="${Y(goal)}" style="stroke:var(--ink-2);stroke-width:1.5"/><text x="${L+8}" y="${Y(goal)-7}" text-anchor="start" style="fill:var(--ink);font-weight:600">Goal ${mk(goal)}</text>`;
  for(const s of scen){let d='';for(let m=0;m<=horizon;m+=Math.max(1,Math.round(horizon/120))){const v=bal(s,m);d+=(d?'L':'M')+X(m).toFixed(1)+' '+Y(v).toFixed(1);if(v>=ymax||v<0)break}
    g+=`<path d="${d}" style="fill:none;stroke:${s.color};stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round"/>`;
    if(isFinite(s.n)&&s.n<=horizon)g+=`<circle cx="${X(s.n)}" cy="${Y(goal)}" r="5.5" style="fill:${s.color};stroke:var(--surface);stroke-width:2" data-tip="${tipId(`<div class="t-h">${esc(s.name)}</div>${tipRow('Reach goal',when(s.n))}${tipRow('Time',fmtDur(s.n))}${tipRow('Saving',m0(s.c)+'/mo')}`)}"/>`}
  const inp=(id,label,val,pre,suf,w)=>`<label class="g-in"><span>${label}</span><span class="money-in" style="width:${w}px">${pre?`<span>${pre}</span>`:''}<input id="${id}" inputmode="decimal" value="${val}" aria-label="${label}">${suf?`<span>${suf}</span>`:''}</span></label>`;
  return `<section class="card c12 goal"><div class="card-h"><h2>Projected savings</h2><span class="sub">How long until you hit your goal</span></div>
    <div class="g-inputs">${inp('goalIn','Target goal',goal.toLocaleString('en-US'),'$','',150)}${inp('savedIn','Already saved',saved.toLocaleString('en-US'),'$','',140)}${inp('incomeIn','Income before taxes',income.toLocaleString('en-US'),'$','/yr',170)}${inp('retIn','Yearly return',ret,'','%',90)}</div>
    <div class="g-cards">${scen.map(s=>`<div class="g-card"><div class="g-h"><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</div>
      <div class="g-big">${fmtDur(s.n)}</div>
      <div class="g-sub">${s.c>0?`Saving <b>${m0(s.c)}</b> a month${isFinite(s.n)&&s.n>0?` · reach it around <b>${when(s.n)}</b>`:''}`:`You’d spend <b>${m0(-s.c)}</b> a month more than you take home.`}</div>
      <div class="g-foot">Spending ${m0(s.spend)}/mo · take-home ${m0(take)}/mo</div></div>`).join('')}</div>
    <div class="chart" style="margin-top:14px"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Savings growth toward goal">${g}</svg></div>
    <p class="life-note">Assumes your take-home pay stays the same, everything you don’t spend is saved and invested at the yearly return you set (7% is a common long-run stock market assumption, not a promise), and taxes for a single filer in California. “Bare minimum” uses rent, necessities and groceries only. Not financial advice.</p></section>`;
}
S.board={};S.votes={};S.names={};
let namesPending=false;
async function resolveNames(){if(!S.user||namesPending)return;const ids=Object.keys(S.board||{}).filter(id=>!(id in S.names));if(!ids.length)return;namesPending=true;
  try{const ps=await S.user.profiles(ids);for(const id of ids)S.names[id]=(ps[id]&&ps[id].name)||''}catch(e){}namesPending=false;requestRender()}
const ago=ts=>{const s=(Date.now()-ts)/1000;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';const d=Math.floor(s/86400);return d<30?d+'d ago':new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})};
function boardPosts(){const out=[];for(const [uid,doc] of Object.entries(S.board||{}))for(const p of (doc.posts||[])){const key=uid+':'+p.id;let score=0,mine=false;for(const [vid,v] of Object.entries(S.votes||{}))if(v&&v.up&&v.up[key]){score++;if(vid===S.uid)mine=true}out.push({...p,uid,key,score,mine})}return out}
function communityHtml(){
  if(!S.db||!S.uid)return `<p class="muted" style="margin:0">The community board works when this page is opened in Claude by someone signed in. Your own list is under “My list”.</p>`;
  const sort=UI.bkSort||'top';const posts=boardPosts().sort((a,b)=>sort==='new'?b.at-a.at:(b.score-a.score)||(b.at-a.at));
  const myList=new Set(((S.meta&&S.meta.bucket)||[]).map(x=>x.name.toLowerCase()));
  return `<form id="postForm" class="bk-form" autocomplete="off"><input class="pass" id="postText" placeholder="Share something you want to spend on" aria-label="Spend It idea" maxlength="120"><button class="btn primary" type="submit">Post</button></form>
    <div class="bd-sort"><span class="muted">${posts.length} idea${posts.length===1?'':'s'}</span><div class="seg"><button class="${sort==='top'?'on':''}" data-act="bd-sort" data-s="top">Top</button><button class="${sort==='new'?'on':''}" data-act="bd-sort" data-s="new">New</button></div></div>
    ${posts.length?`<ul class="bd-list">${posts.map(p=>{const who=p.uid===S.uid?'you':(S.names[p.uid]||'Someone');const canDel=p.uid===S.uid||S.isOwner;return `<li class="bd"><button class="vote${p.mine?' on':''}" data-act="bd-vote" data-k="${esc(p.key)}" aria-pressed="${p.mine}" aria-label="${p.mine?'Remove upvote':'Upvote'}: ${esc(p.text)}"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2l5 6H9v4H5V8H2z" fill="currentColor"/></svg><b>${p.score}</b></button>
      <div class="bd-main"><div class="bd-text"></div><div class="bd-meta"><span class="bd-who"></span> · ${ago(p.at)}</div></div>
      <div class="bd-ctl">${myList.has(String(p.text).toLowerCase())?'<span class="pill good">✓ On my list</span>':`<button class="btn ghost" data-act="bd-copy" data-k="${esc(p.key)}">+ My list</button>`}${canDel?`<button class="btn ghost bk-x" data-act="bd-del" data-k="${esc(p.key)}" aria-label="Delete post">✕</button>`:''}</div>
      <template data-text="${esc(p.text)}" data-who="${esc(who)}"></template></li>`}).join('')}</ul>`:`<p class="muted">No ideas yet. Post the first one!</p>`}
    <p class="fine">Everyone this page is shared with can see posts and names on the board. Your spending data stays private.</p>`;
}
async function boardWrite(fn){try{await fn()}catch(e){toast(e&&e.code==='invalid_argument'?'You can view the board but can’t post or vote. Ask the owner to give you edit access.':'Couldn’t save that. Try again.')}}
document.addEventListener('submit',e=>{if(e.target.id!=='postForm')return;e.preventDefault();
  const text=$('#postText').value.trim().slice(0,120);
  if(text.length<3){toast('Write something you want to spend on first.');return}
  const mine=((S.board[S.uid]||{}).posts||[]);if(mine.length>=25){toast('You can have up to 25 posts. Delete one to add more.');return}
  const post={id:Math.random().toString(36).slice(2,10),text,at:Date.now()};
  if(document.activeElement)document.activeElement.blur();
  boardWrite(()=>S.db.doc('board/'+S.uid).set({posts:[...mine,post]}));
});
function bucketHtml(SP,total,nM){
  if(!S.db||!S.uid)return myBucketHtml(SP,total,nM);
  const tab=UI.bkTab||(S.db&&S.uid?'community':'mine');
  const head=`<div class="card-h"><h2>Spend It</h2><div class="seg" role="tablist"><button class="${tab==='community'?'on':''}" data-act="bk-tab" data-t="community" role="tab" aria-selected="${tab==='community'}">Community</button><button class="${tab==='mine'?'on':''}" data-act="bk-tab" data-t="mine" role="tab" aria-selected="${tab==='mine'}">My list</button></div></div>`;
  if(tab==='community')return `<section class="card c12 bucket">${head}${communityHtml()}</section>`;
  return myBucketHtml(SP,total,nM).replace('<section class="card c12 bucket"><div class="card-h"><h2>Spend It</h2>','<section class="card c12 bucket">'+head+'<div class="card-h" style="margin-top:-4px"><span></span>');
}
function myBucketHtml(SP,total,nM){
  const B=(S.meta&&S.meta.bucket)||[];const save=+((S.meta&&S.meta.saveAmt)??500)||0;
  const inG=id=>SP.filter(t=>gOf(t.cat)&&gOf(t.cat).id===id).reduce((s,t)=>s+t.a,0);
  const ideas=[];
  if(inG('travel')>total*.1)ideas.push(['Two weeks in Europe',6000],['Return trip to Japan',4500]);
  if(inG('fun')>total*.04)ideas.push(['Festival weekend with friends',1500]);
  if(inG('alcohol')>total*.03)ideas.push(['Vegas birthday weekend',2000]);
  ideas.push(['Emergency fund (3 months)',Math.round(((S.meta&&S.meta.rent)??2000)*3+ (total/Math.max(1,nM))*3)],['New laptop',1800],['Skydiving',300]);
  const have=new Set(B.map(x=>x.name.toLowerCase()));const sug=ideas.filter(x=>!have.has(x[0].toLowerCase())).slice(0,5);
  const now=new Date();let cum=0;
  const rows=B.map((x,i)=>{let when='';if(!x.done){cum+=x.cost;const n=save>0?Math.ceil(cum/save):Infinity;when=isFinite(n)?(n<=0?'Now':(()=>{const d=new Date(now.getFullYear(),now.getMonth()+n,1);return MONTHS[d.getMonth()]+' '+d.getFullYear()})()):'Set a savings amount'}
    const n=save>0&&!x.done?Math.ceil(cum/save):0;
    return `<li class="bk${x.done?' done':''}" draggable="true" data-bk="${i}"><button class="bk-check" data-act="bk-done" data-i="${i}" aria-label="${x.done?'Mark not done':'Mark done'}: ${esc(x.name)}" aria-pressed="${!!x.done}">${x.done?'✓':''}</button>
      <div class="bk-main"><div class="bk-name">${esc(x.name)}</div><div class="bk-sub">${x.done?'Done':x.cost>0?`${m0(x.cost)} · ${isFinite(n)&&n>0?`about ${n} month${n>1?'s':''} of saving`:''}`:`<span class="money-in bk-costin"><span>$</span><input data-bkcost="${i}" inputmode="decimal" placeholder="Add cost" aria-label="Cost for ${esc(x.name)}"></span>`}</div></div>
      <div class="bk-when">${x.done?'':`<span class="muted">Ready by</span><b>${esc(when)}</b>`}</div>
      <div class="bk-ctl"><button class="btn ghost bk-mv" data-act="bk-up" data-i="${i}" ${i===0?'disabled':''} aria-label="Move ${esc(x.name)} up">↑</button><button class="btn ghost bk-mv" data-act="bk-down" data-i="${i}" ${i===B.length-1?'disabled':''} aria-label="Move ${esc(x.name)} down">↓</button><button class="btn ghost bk-x" data-act="bk-rm" data-i="${i}" aria-label="Remove ${esc(x.name)}">✕</button></div></li>`}).join('');
  const open=B.filter(x=>!x.done).reduce((s,x)=>s+x.cost,0);
  return `<section class="card c12 bucket"><div class="card-h"><h2>Spend It</h2><span class="sub">${save>0?`Saving ${m0(save)} a month toward these, in order`:'Set a monthly Savings amount above to see when you can afford each one'}</span></div>
    ${B.length?`<ul class="bk-list">${rows}</ul><div class="bk-total"><span>${B.filter(x=>!x.done).length} to go · ${m0(open)} total</span>${save>0&&open>0?`<span>Everything done in about <b>${Math.ceil(open/save)} months</b></span>`:''}</div>`:`<p class="muted" style="margin:0 0 12px">Add the things you want to do or buy, and Spend It shows when your savings will cover each one.</p>`}
    <form id="bucketForm" class="bk-form" autocomplete="off"><input class="pass" id="bkName" placeholder="Something you want to do or buy" aria-label="Something to spend on" maxlength="80"><span class="money-in"><span>$</span><input id="bkCost" inputmode="decimal" placeholder="Cost" aria-label="Cost"></span><button class="btn primary" type="submit">Add</button></form>
    ${sug.length?`<div class="bk-ideas"><span class="muted">Ideas for you:</span>${sug.map(([n,c])=>`<button class="tag bk-idea" data-act="bk-add" data-n="${esc(n)}" data-c="${c}">+ ${esc(n)} · ${mk(c)}</button>`).join('')}</div>`:''}</section>`;
}
let bkDrag=null;
document.addEventListener('dragstart',e=>{const li=e.target.closest&&e.target.closest('.bk');if(!li)return;bkDrag=+li.dataset.bk;li.classList.add('dragging');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','bk')}catch(x){}});
document.addEventListener('dragover',e=>{const li=e.target.closest&&e.target.closest('.bk');if(bkDrag==null||!li)return;e.preventDefault();document.querySelectorAll('.bk').forEach(n=>n.classList.remove('drop-above','drop-below'));const r=li.getBoundingClientRect();li.classList.add(e.clientY<r.top+r.height/2?'drop-above':'drop-below')});
document.addEventListener('drop',e=>{const li=e.target.closest&&e.target.closest('.bk');if(bkDrag==null)return;e.preventDefault();e.stopPropagation();
  if(li){const r=li.getBoundingClientRect();let to=+li.dataset.bk+(e.clientY<r.top+r.height/2?0:1);const B=[...((S.meta&&S.meta.bucket)||[])];const [it]=B.splice(bkDrag,1);if(to>bkDrag)to--;B.splice(to,0,it);bkDrag=null;saveBucket(B)}else bkDrag=null},true);
document.addEventListener('dragend',()=>{bkDrag=null;document.querySelectorAll('.bk').forEach(n=>n.classList.remove('dragging','drop-above','drop-below'))});
function fillBoardText(){document.querySelectorAll('.bd template[data-text]').forEach(t=>{const li=t.closest('.bd');li.querySelector('.bd-text').textContent=t.dataset.text;li.querySelector('.bd-who').textContent=t.dataset.who;t.remove()})}
function saveBucket(B){S.meta={...S.meta,bucket:B};if(!S.example)saveMeta();pendingRender=false;requestRender()}
document.addEventListener('submit',e=>{if(e.target.id!=='bucketForm')return;e.preventDefault();
  const n=$('#bkName').value.trim(),c=parseFloat(($('#bkCost').value||'').replace(/[^\d.]/g,''));
  if(!n||!(c>0)){toast('Add a name and a cost.');return}
  if(document.activeElement)document.activeElement.blur();
  saveBucket([...((S.meta&&S.meta.bucket)||[]),{name:n.slice(0,80),cost:c,done:false}]);
});
function simDebts(debts,extra,strat){
  let ds=debts.map((d,i)=>({i,name:d.name,bal:Math.max(0,+d.bal||0),r:(+d.apr||0)/100/12,min:Math.max(0,+d.min||0),paidAt:null}));
  let month=0,interest=0;const series=[ds.reduce((s,d)=>s+d.bal,0)];
  while(ds.some(d=>d.bal>0.005)&&month<600){
    month++;let pool=extra;
    for(const d of ds){if(d.bal<=0)continue;const it=d.bal*d.r;interest+=it;d.bal+=it}
    // freed minimums roll into the pool
    for(const d of ds){if(d.bal<=0){if(strat!=='min')pool+=d.min;continue}const pay=Math.min(d.min,d.bal);d.bal-=pay;if(pay<d.min&&strat!=='min')pool+=d.min-pay}
    if(strat!=='min'){const order=ds.filter(d=>d.bal>0.005).sort((a,b)=>strat==='avalanche'?(b.r-a.r)||(a.bal-b.bal):(a.bal-b.bal)||(b.r-a.r));
      for(const d of order){if(pool<=0)break;const pay=Math.min(pool,d.bal);d.bal-=pay;pool-=pay}}
    for(const d of ds)if(d.bal<=0.005&&d.paidAt==null){d.bal=0;d.paidAt=month}
    series.push(ds.reduce((s,d)=>s+d.bal,0));
    if(month>24&&series[month]>=series[month-12]-0.01)return {months:Infinity,interest:Infinity,series,ds};
  }
  return {months:ds.some(d=>d.bal>0.005)?Infinity:month,interest,series,ds};
}
function debtHtml(){
  const M=S.meta||{};const debts=M.debts||[];const extra=+(M.debtExtra??100)||0;const strat=M.debtStrat||'avalanche';
  const row=(d,i)=>`<tr><td><input class="dt-in" data-debt="${i}" data-f="name" value="${esc(d.name)}" aria-label="Debt name" maxlength="40"></td>
    <td><span class="money-in"><span>$</span><input data-debt="${i}" data-f="bal" inputmode="decimal" value="${d.bal||''}" placeholder="0" aria-label="Balance for ${esc(d.name)}"></span></td>
    <td><span class="money-in"><input data-debt="${i}" data-f="apr" inputmode="decimal" value="${d.apr||''}" placeholder="0" aria-label="Interest rate for ${esc(d.name)}"><span>%</span></span></td>
    <td><span class="money-in"><span>$</span><input data-debt="${i}" data-f="min" inputmode="decimal" value="${d.min||''}" placeholder="0" aria-label="Minimum payment for ${esc(d.name)}"></span></td>
    <td><button class="btn ghost bk-x" data-act="debt-rm" data-i="${i}" aria-label="Remove ${esc(d.name)}">✕</button></td></tr>`;
  const table=`<div class="tbl-wrap"><table class="dt"><thead><tr><th>Debt</th><th>Balance</th><th>Interest (APR)</th><th>Min payment</th><th></th></tr></thead><tbody>${debts.map(row).join('')}</tbody></table></div>
    <div class="dt-actions"><button class="btn" data-act="debt-add">+ Add a debt</button>
    <label class="rent-in"><span>Extra payment</span><span class="money-in"><span>$</span><input id="debtExtra" inputmode="decimal" value="${extra}" aria-label="Extra monthly payment"></span><span class="muted">/mo</span></label>
    <div class="seg" role="group" aria-label="Payoff strategy"><button class="${strat==='avalanche'?'on':''}" data-act="debt-strat" data-s="avalanche">Avalanche</button><button class="${strat==='snowball'?'on':''}" data-act="debt-strat" data-s="snowball">Snowball</button></div></div>`;
  const valid=debts.filter(d=>+d.bal>0);
  if(!valid.length)return `<section class="card c12 debt"><div class="card-h"><h2>Debt payoff calculator</h2><span class="sub">Credit cards, car loans, student loans</span></div>${debts.length?table:`<p class="muted" style="margin:0 0 12px">Add each debt with its balance, interest rate and minimum payment to see when you’ll be debt-free and how much interest you’ll pay.</p><div class="dt-actions"><button class="btn primary" data-act="debt-add">+ Add a debt</button></div>`}</section>`;
  const res={min:simDebts(valid,0,'min'),avalanche:simDebts(valid,extra,'avalanche'),snowball:simDebts(valid,extra,'snowball')};
  const R0=res[strat];const now=new Date();
  const when=n=>{if(!isFinite(n))return 'Never';const d=new Date(now.getFullYear(),now.getMonth()+n,1);return MONTHS[d.getMonth()]+' '+d.getFullYear()};
  const tot=valid.reduce((s,d)=>s+(+d.bal),0),mins=valid.reduce((s,d)=>s+(+d.min||0),0);
  const saveInt=isFinite(res.min.interest)&&isFinite(R0.interest)?res.min.interest-R0.interest:null;
  const card=(k,label,note)=>{const r=res[k];return `<div class="g-card${k===strat?' dt-on':''}"><div class="g-h">${label}</div><div class="g-big">${isFinite(r.months)?fmtDur(r.months):'Never'}</div><div class="g-sub">${isFinite(r.months)?`Debt-free by <b>${when(r.months)}</b> · <b>${m0(r.interest)}</b> interest`:'Payments don’t cover the interest. Pay more each month.'}</div><div class="g-foot">${note}</div></div>`};
  // chart
  const W=Math.max(300,cardW(12)),H=220,L=58,Rr=12,T=14,B=26,iw=W-L-Rr,ih=H-T-B;
  const hz=Math.max(12,Math.min(600,Math.max(...[res.min,R0].map(r=>isFinite(r.months)?r.months:Math.min(r.series.length-1,240)))));
  const ymax=niceMax(tot);const X=m=>L+iw*m/hz,Y=v=>T+ih-Math.max(0,Math.min(v,ymax))/ymax*ih;
  let g='';for(let k=0;k<=4;k++){const v=ymax*k/4;g+=`<line class="${k?'grid-l':'base'}" x1="${L}" x2="${W-Rr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L-8}" y="${Y(v)+4}" text-anchor="end">${mk(v)}</text>`}
  const yrs=Math.ceil(hz/12),st=yrs>20?5:yrs>8?2:1;for(let y=0;y<=yrs;y+=st){if(y*12>hz)break;g+=`<text x="${X(y*12)}" y="${H-7}" text-anchor="middle">${now.getFullYear()+y}</text>`}
  const line=(r,c)=>{let d='';r.series.slice(0,hz+1).forEach((v,m)=>{d+=(d?'L':'M')+X(m).toFixed(1)+' '+Y(v).toFixed(1)});return `<path d="${d}" style="fill:none;stroke:${c};stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round"/>`};
  g+=line(res.min,'var(--s0)')+line(R0,'var(--accent)');
  const order=[...R0.ds].filter(d=>d.paidAt!=null).sort((a,b)=>a.paidAt-b.paidAt);
  return `<section class="card c12 debt"><div class="card-h"><h2>Debt payoff calculator</h2><span class="sub">${m0(tot)} total · ${m0(mins+extra)}/mo going to debt</span></div>
    ${table}
    <div class="g-cards" style="margin-top:16px">${card(strat,strat==='avalanche'?'Avalanche: highest interest first':'Snowball: smallest balance first',`Minimums plus ${m0(extra)} extra a month${saveInt>0?`, saving <b>${m0(saveInt)}</b> in interest vs minimums only`:''}`)}${card('min','Minimum payments only',`Paying just ${m0(mins)} a month`)}</div>
    <div class="chart" style="margin-top:14px"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Debt balance over time">${g}</svg></div>
    <div class="series-legend"><span><i class="sw" style="background:var(--accent)"></i>${strat==='avalanche'?'Avalanche':'Snowball'} with extra payment</span><span><i class="sw" style="background:var(--s0)"></i>Minimum payments only</span></div>
    ${order.length?`<div class="st-h" style="margin-top:16px">Payoff order</div><ol class="dt-order">${order.map(d=>`<li><b>${esc(d.name)}</b><span>paid off ${when(d.paidAt)}</span></li>`).join('')}</ol>`:''}
    <p class="life-note">Avalanche saves the most interest. Snowball clears small debts first, which some people find more motivating. When a debt is paid off, its minimum rolls into the next one. Estimates assume fixed rates and no new charges.</p></section>`;
}
function personaHtml(SP,total,nM){
  if(!SP.length||total<=0)return '';
  const sum=f=>SP.filter(f).reduce((s,t)=>s+t.a,0),cnt=f=>SP.filter(f).length;
  const inC=(...c)=>t=>c.includes(t.cat),inG=id=>t=>gOf(t.cat)&&gOf(t.cat).id===id;
  const travel=sum(inG('travel')),events=sum(inG('fun')),shop=sum(inG('shop'));
  const alc=sum(inG('alcohol')),alcN=cnt(inG('alcohol'));
  const eatOut=sum(inC('Restaurants','Fast Food','Food Delivery')),eatN=cnt(inC('Restaurants','Fast Food','Food Delivery')),groc=sum(inC('Groceries'));
  const rides=cnt(inC('Rideshare & Taxi')),deliv=cnt(inC('Food Delivery'));
  const treats=cnt(inC('Coffee, Tea & Drinks','Desserts & Bakery')),treatV=sum(inC('Coffee, Tea & Drinks','Desserts & Bakery'));
  const give=sum(inC('Charity & Giving')),fit=sum(inC('Fitness')),care=sum(inC('Personal Care','Clothing'));
  const cc={};for(const t of SP){const m=(t.r||'').trim().match(/\b([A-Z]{2})$/);if(m&&!US_ST.has(m[1])&&COUNTRY[m[1]]&&!/paypal/i.test(t.r))cc[m[1]]=(cc[m[1]]||0)+1}const ctry=Object.entries(cc).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).map(([k])=>COUNTRY[k]);const listJ=a=>a.length<3?a.join(' and '):a.slice(0,-1).join(', ')+' and '+a[a.length-1];
  const exp=travel+events+alc,social=alcN>=10||eatOut>groc*1.2;
  let name,desc;
  if(travel>=total*.1&&social){name='The Social Explorer';desc='You spend on experiences and people, not stuff. Your money goes to trips, nights out and meals with friends, and you’ll happily pay for convenience so you can spend your time doing things instead of running errands.'}
  else if(travel>=total*.1){name='The Adventurer';desc='New places matter more to you than new things. You keep everyday spending modest and save your big money for trips.'}
  else if(social){name='The Social Butterfly';desc='Your spending follows your social life. Restaurants, bars and events are where your money goes, because that’s where your people are.'}
  else if(shop>=total*.2){name='The Collector';desc='You like having nice things. A good share of your money goes to shopping, clothes and things for your home.'}
  else if(groc>eatOut*1.2){name='The Homebody';desc='You’re practical and home-centered. You cook more than you eat out and keep splurges rare.'}
  else {name='The Balanced Spender';desc='Your spending is spread evenly, without one big habit pulling it in any direction.'}
  const V=[];
  const tidy=n=>String(n||'').replace(/(\s+(&|-|\d+|san|of))+$/i,'').replace(/\s+(San Francisco|Sacramento|Elk Grove|Tokyo|Seoul|Kyoto|Las Vegas)(\s+(Ca|Jp|Kr|Nv))?$/i,'').replace(/^(Sq|Tst|Dd|Par|Py|Spo|Fsp|Ls|Jms|Tm|Eb|Fh|Lsu)\s*\*\s*/i,'').replace(/\s*\(npu\)$/i,'').trim();
  const top=(f,n=3,by='v')=>{const m=new Map();for(const t of SP.filter(f)){const k=tidy(t.m);if(!k)continue;const o=m.get(k)||{v:0,c:0};o.v+=t.a;o.c++;m.set(k,o)}return [...m].sort((a,b)=>b[1][by]-a[1][by]).slice(0,n).map(x=>x[0])};
  const inCat=(...c)=>t=>c.includes(t.cat);
  const tripSpots=top(inCat('Lodging','Travel & Vacation','Flights'),3);
  const eventSpots=top(inG('fun'),3);const barSpots=top(inG('alcohol'),3,'c');const foodSpots=top(inCat('Restaurants'),3,'c');
  const treatSpots=top(inCat('Coffee, Tea & Drinks','Desserts & Bakery'),3,'c');
  const rideApp=top(inCat('Rideshare & Taxi'),1,'c')[0]||'rideshare',delApp=top(inCat('Food Delivery'),1,'c')[0]||'delivery';
  const giveTo=top(inCat('Charity & Giving'),2);const gyms=top(inCat('Fitness'),2);const style=top(inCat('Clothing','Personal Care'),3);
  const yrs=[...new Set(SP.filter(t=>{const m=(t.r||'').trim().match(/\b([A-Z]{2})$/);return m&&COUNTRY[m[1]]&&!US_ST.has(m[1])}).map(t=>t.d.slice(0,4)))];
  const when=yrs.length===1&&yrs[0]===String(new Date().getFullYear())?'this year':'recently';
  const bar1=top(inCat('Bars & Nightlife'),1,'c')[0],food1=foodSpots[0],treat1=treatSpots[0];const ev1=top(inG('fun'),10).find(n=>!/ticket|axs|dice|fandango|groupon|cinema|regal|cinemark|steam|16personal/i.test(n));
  if(exp>shop*2&&exp>total*.15)V.push([exp,'Experiences over things',`You’d rather do things than buy them${ctry.length?`, from your ${ctry[0]} trip`:''}${ev1?`${ctry.length?' to shows at':', like shows at'} ${ev1}`:''}.`]);
  if(ctry.length)V.push([travel,'Seeing the world',`You went to ${listJ(ctry)} ${when}, so you clearly love to explore.`]);
  if(social)V.push([eatOut+alc,'Time with friends',`${bar1||food1?`Nights at spots like ${bar1||food1} show`:'Your meals and drinks out show'} how much you value time with people.`]);
  if(rides+deliv>=20)V.push([rides*20,'Convenience and your time',`${rides} ${rideApp} rides say you’d rather pay a little than spend time driving.`]);
  if(treats>=15)V.push([treatV,'Little daily treats',`${treat1?`Regular stops at ${treat1} show`:'Your regular coffee runs show'} a drink or sweet is part of your routine.`]);
  if(events>=total*.04)V.push([events,'Music and live events',`${ev1?`You made it to ${ev1} and more, so`:'Concerts and shows add up for you, so'} live events are a priority.`]);
  if(give>0)V.push([give*5,'Giving back',`You give regularly${giveTo.length?` to ${giveTo[0]}`:''}, so supporting your community matters to you.`]);
  if(fit>0)V.push([fit*3,'Staying active',`You make time to move${gyms.length?`, at places like ${gyms[0]}`:''}.`]);
  if(care>=total*.04)V.push([care,'Looking good',`You invest in how you look${style.length?`, with spots like ${style[0]}`:''}.`]);
  const vals=V.sort((a,b)=>b[0]-a[0]).slice(0,6);
  return {name,desc,vals};
}
function summaryHtml(SP,total,nM,b){
  if(!SP.length||total<=0)return '';
  const sum=f=>SP.filter(f).reduce((s,t)=>s+t.a,0),cnt=f=>SP.filter(f).length;
  const pct=v=>Math.round(v/total*100);
  const inC=(...c)=>t=>c.includes(t.cat);
  const eatOut=sum(inC('Restaurants','Fast Food','Food Delivery')),groc=sum(inC('Groceries'));
  const drinks=sum(inC('Coffee, Tea & Drinks')),drinksN=cnt(inC('Coffee, Tea & Drinks'));
  const alc=sum(inC('Bars & Nightlife','Liquor & Wine')),alcN=cnt(inC('Bars & Nightlife','Liquor & Wine'));
  const travel=sum(t=>gOf(t.cat)&&gOf(t.cat).id==='travel');
  const fun=sum(t=>gOf(t.cat)&&gOf(t.cat).id==='fun');
  const ride=sum(inC('Rideshare & Taxi')),rideN=cnt(inC('Rideshare & Taxi')),gas=sum(inC('Gas & EV Charging'));
  const shop=sum(t=>gOf(t.cat)&&gOf(t.cat).id==='shop');
  const per=b.single?'':' a month';const pm=v=>m0(b.single?v:v/nM);
  const S=[];const tags=[];
  const G=GROUPS.filter(g=>g.id!=='other').map(g=>({g,v:sum(t=>gOf(t.cat)===g)})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v).slice(0,3);
  S.push(`You spend about <b>${pm(total)}${per}</b>${G.length?`, and your money goes mostly to <b>${G.map(x=>`${esc(x.g.name.toLowerCase())}</b> (${pct(x.v)}%)`).join(G.length>2?', <b>':' and <b>').replace(/, <b>([^,]*)$/,', and <b>$1')}`:''}.`);
  if(eatOut+groc>0){
    if(eatOut>groc*1.2){S.push(`You’d rather eat out than cook: restaurants, fast food and delivery come to <b>${pm(eatOut)}${per}</b>, compared with ${pm(groc)} on groceries.`);tags.push('Loves eating out')}
    else if(groc>eatOut*1.2){S.push(`You mostly eat at home: groceries are <b>${pm(groc)}${per}</b>, more than the ${pm(eatOut)} you spend eating out.`);tags.push('Home cook')}
    else S.push(`You split food evenly between eating out (${pm(eatOut)}${per}) and groceries (${pm(groc)}${per}).`);
  }
  if(alc>=total*.03&&alcN>=4){S.push(`Nights out are a real part of your spending, with <b>${alcN} bar, club and liquor purchases</b> totaling ${mAuto(alc)}.`);tags.push('Social drinker')}
  if(drinksN>=8){S.push(`You’re a regular at coffee, matcha and boba spots: <b>${drinksN} drinks</b> for ${mAuto(drinks)}, about ${m2(drinks/drinksN)} each.`);tags.push('Coffee & boba fan')}
  if(travel>=total*.1){S.push(`Travel is your biggest splurge at <b>${mAuto(travel)}</b> (${pct(travel)}% of everything), and it drives your most expensive months.`);tags.push('Traveler')}
  if(fun>=total*.04)tags.push('Concerts & events');
  if(ride>gas&&rideN>=8){S.push(`You get around mostly by Uber and Lyft, with <b>${rideN} rides</b> costing ${mAuto(ride)}${gas>0?`, versus ${mAuto(gas)} on gas`:''}.`);tags.push('Rideshare regular')}
  else if(gas>0&&gas>=ride){S.push(`You mostly drive yourself, spending ${pm(gas)}${per} on gas.`);tags.push('Drives everywhere')}
  if(shop>=total*.12)tags.push('Shopper');
  const wk=sum(t=>[0,5,6].includes(dow(t.d)));if(wk/total>=.5)tags.push('Weekend spender');
  return {tags,S};
}
function insightsHtml(T,F,SP,total,nM,b){
  const L=[];if(!SP.length)return '<p class="muted">No spending in this range.</p>';
  const pos=SP.filter(t=>t.a>0);
  const gT=GROUPS.map(g=>({g,v:SP.filter(t=>gOf(t.cat)===g).reduce((s,t)=>s+t.a,0)})).sort((a,b)=>b.v-a.v);
  const cT=[...sumBy(SP,t=>t.cat)].sort((a,b)=>b[1]-a[1]);
  if(gT[0].v>0)L.push([IC.pie,`<b>${esc(gT[0].g.name)}</b> takes <b>${Math.round(gT[0].v/total*100)}%</b> of your spending. <b>${esc(cT[0][0])}</b> alone is ${m0(cT[0][1])}${nM>1?`, about ${m0(cT[0][1]/nM)} a month`:''}.`]);
  // priciest weekday, averaged per calendar day of that weekday
  const d0=dayNum(SP[SP.length-1].d),d1=dayNum(SP[0].d),days=d1-d0+1;
  const cntDow=[0,0,0,0,0,0,0];for(let d=d0;d<=d1;d++)cntDow[new Date(d*864e5).getUTCDay()]++;
  const sDow=[0,0,0,0,0,0,0];for(const t of SP)sDow[dow(t.d)]+=t.a;
  const avgDow=sDow.map((v,i)=>cntDow[i]?v/cntDow[i]:0);const hi=avgDow.indexOf(Math.max(...avgDow)),lo=avgDow.indexOf(Math.min(...avgDow));
  const FULL=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const perYr=v=>v/(b.single?1:nM)*12;
  const inCats=(...c)=>SP.filter(t=>c.includes(t.cat));
  // subscriptions
  const subs=inCats('Subscriptions');if(subs.length){const v=subs.reduce((s,t)=>s+t.a,0);const names=[...new Set(subs.map(t=>t.m))].slice(0,3);
    L.push([IC.stack,`Subscriptions run about <b>${m0(perYr(v))} a year</b>${names.length?` (${names.map(esc).join(', ')})`:''}. Cancel the ones you don’t use.`])}
  // coffee habit
  const dr=inCats('Coffee, Tea & Drinks');if(dr.length>=8){const v=dr.reduce((s,t)=>s+t.a,0),avg=v/dr.length;
    L.push([IC.coin,`Your coffee, matcha and boba habit costs about <b>${m0(perYr(v))} a year</b>. ${dr.length/((d1-d0+1)/7)>=2?`Skipping just one ${m2(avg)} drink a week saves <b>${m0(avg*52)}</b>.`:`That’s about ${m2(avg)} a drink; cutting it in half saves <b>${m0(perYr(v)/2)}</b>.`}`])}
  // night out cost
  const bars=inCats('Bars & Nightlife','Liquor & Wine');if(bars.length>=4){const nights=sumBy(bars,t=>t.d);const per=[...nights.values()].reduce((s,v)=>s+v,0)/nights.size;
    L.push([IC.flame,`A night out costs you about <b>${m0(per)}</b> in drinks and cover. You went out on <b>${nights.size} nights</b>, about ${(nights.size/(b.single?1:nM)).toFixed(1)} a month.`])}
  // rides
  const rd=inCats('Rideshare & Taxi');if(rd.length>=8){const v=rd.reduce((s,t)=>s+t.a,0);
    L.push([IC.car,`Uber and Lyft cost about <b>${m0(perYr(v))} a year</b>, ${m2(v/rd.length)} a ride. Transit or biking on a few of those trips adds up fast.`])}
  // weekend premium
  {const isWk=t=>[0,5,6].includes(dow(t.d));let wkD=0,wdD=0;for(let d=d0;d<=d1;d++){const w=new Date(d*864e5).getUTCDay();if([0,5,6].includes(w))wkD++;else wdD++}
   const wkV=SP.filter(isWk).reduce((s,t)=>s+t.a,0),wdV=SP.filter(t=>!isWk(t)).reduce((s,t)=>s+t.a,0);
   if(wkD&&wdD){const a1=wkV/wkD,a2=wdV/wdD;if(a1>a2*1.15)L.push([IC.spark,`Friday to Sunday you spend <b>${m0(a1)} a day</b>, compared with ${m0(a2)} on weekdays. That weekend premium is about <b>${m0((a1-a2)*156)} a year</b>.`])}}
  // fees
  const fees=inCats('Fees & Interest').reduce((s,t)=>s+t.a,0);
  L.push([IC.target,fees>0?`You paid <b>${m2(fees)}</b> in card fees and interest. Paying in full each month avoids it.`:`You paid <b>$0 in interest or card fees</b>. Paying your cards in full is saving you money.`]);
  // typical purchase + small stuff
  const small=pos.filter(t=>t.a<15);
  L.push([IC.coin,`Your typical purchase is <b>${m2(median(pos.map(t=>t.a)))}</b>.${small.length>=8?` Small stuff adds up: ${small.length} charges under $15 came to <b>${mAuto(small.reduce((s,t)=>s+t.a,0))}</b>.`:''}`]);
  // trend: last 3 months vs 3 before
  const ms=[...new Set(SP.map(t=>t.d.slice(0,7)))].sort();
  if(!b.single&&ms.length>=6){
    const last=ms.slice(-3),prev=ms.slice(-6,-3);const inM=a=>t=>a.includes(t.d.slice(0,7));
    const lv=SP.filter(inM(last)).reduce((s,t)=>s+t.a,0),pv=SP.filter(inM(prev)).reduce((s,t)=>s+t.a,0);
    if(pv>0){const ch=(lv-pv)/pv;const gd=GROUPS.map(g=>({g,d:SP.filter(t=>inM(last)(t)&&gOf(t.cat)===g).reduce((s,t)=>s+t.a,0)-SP.filter(t=>inM(prev)(t)&&gOf(t.cat)===g).reduce((s,t)=>s+t.a,0)})).sort((a,b)=>ch<0?a.d-b.d:b.d-a.d)[0];
      L.push([IC.up,`Your last 3 months are <b>${ch<0?'down':'up'} ${Math.abs(Math.round(ch*100))}%</b> from the 3 before (${mLabel(prev[0])}–${mLabel(prev[2])} vs ${mLabel(last[0])}–${mLabel(last[2])})${gd&&Math.abs(gd.d)>50?`, mostly ${ch<0?'less':'more'} on ${esc(gd.g.name.toLowerCase())}`:''}.`])}
  }else if(!b.single&&ms.length>=3){const mt=[...sumBy(SP,t=>t.d.slice(0,7))].sort((a,b)=>b[1]-a[1]);const avg=total/mt.length;L.push([IC.up,`<b>${mLabel(mt[0][0],true)}</b> was your biggest month at ${m0(mt[0][1])}, ${Math.round((mt[0][1]/avg-1)*100)}% above your average.`])}
  // what-if
  const eat=SP.filter(t=>['Restaurants','Fast Food','Food Delivery','Coffee, Tea & Drinks','Desserts & Bakery'].includes(t.cat)).reduce((s,t)=>s+t.a,0);
  if(eat>0)L.push([IC.target,`Cutting eating out and drinks in half would free up about <b>${m0(eat/2/(b.single?1:nM)*12)} a year</b>.`]);
  return `<ul class="insights ins-grid">${L.slice(0,12).map(([i,t])=>`<li><span class="ins-ic">${i}</span><span>${t}</span></li>`).join('')}</ul>`;
}

function catOptions(sel){return GROUPS.map(g=>`<optgroup label="${esc(g.name)}">${g.cats.map(c=>`<option${c===sel?' selected':''}>${esc(c)}</option>`).join('')}</optgroup>`).join('')+`<optgroup label="Not spending">${SPECIAL.map(c=>`<option${c===sel?' selected':''}>${c}</option>`).join('')}</optgroup>`}
function txView(T,F){
  return `<section class="card"><div class="toolbar">
    <input class="search" id="txSearch" type="search" placeholder="Search merchants or descriptions" value="${esc(UI.q)}" aria-label="Search transactions">
    <select class="sel" id="txCat" aria-label="Category filter"><option value="all">All categories</option>${GROUPS.map(g=>`<option value="g:${g.id}">${esc(g.name)} (all)</option>`).join('')}<option disabled>──────</option>${ALLCATS.map(c=>`<option value="c:${esc(c)}">${esc(c)}</option>`).join('')}</select>
    <select class="sel" id="txKind" aria-label="Type filter"><option value="all">Everything</option><option value="spend">Spending</option><option value="refund">Refunds</option><option value="transfer">Payments & transfers</option></select>
  </div><div id="txSummary" class="muted" style="font-size:13px;margin:-4px 0 10px"></div><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th class="amt">Amount</th></tr></thead><tbody id="txBody"></tbody></table></div><div class="more" id="txMore"></div></section>`;
}
function renderTxTable(F){
  $('#txCat').value=UI.catF;$('#txKind').value=UI.kindF;
  const q=UI.q.trim().toLowerCase();
  const rows=F.filter(t=>{
    if(q&&!(t.m.toLowerCase().includes(q)||t.r.toLowerCase().includes(q)||t.cat.toLowerCase().includes(q)))return false;
    if(UI.catF.startsWith('g:')){const g=gOf(t.cat);if(!g||g.id!==UI.catF.slice(2))return false}
    if(UI.catF.startsWith('c:')&&t.cat!==UI.catF.slice(2))return false;
    if(UI.kindF==='refund')return t.kind==='spend'&&t.a<0;
    if(UI.kindF!=='all'&&t.kind!==UI.kindF)return false;
    return true;
  });
  const sp=rows.filter(t=>t.kind==='spend').reduce((s,t)=>s+t.a,0);
  $('#txSummary').textContent=`${rows.length} transaction${rows.length===1?'':'s'} · ${m2(sp)} net spending`;
  $('#txBody').innerHTML=rows.slice(0,UI.limit).map(t=>`<tr class="${t.kind!=='spend'?'excluded':''}">
    <td class="date">${dLabel(t.d)}</td>
    <td><div class="merch"><span class="name">${esc(t.m)}</span><span class="raw" title="${esc(t.r)}">${esc(t.r)}${Object.keys(stmts()).length>1?' · '+esc(t.acct):''}</span></div></td>
    <td><span class="catwrap"><i class="sw" style="background:${colorOf(t.cat)}"></i><select class="cat-sel" data-tx="${esc(t.id)}" aria-label="Category for ${esc(t.m)}">${catOptions(t.cat)}</select></span></td>
    <td class="amt ${t.a<0?'in':''}">${t.a<0?'+'+m2(-t.a):m2(t.a)}</td></tr>`).join('')||`<tr><td colspan="4" class="muted" style="padding:24px 6px">No transactions match.</td></tr>`;
  $('#txMore').innerHTML=rows.length>UI.limit?`<button class="btn" data-act="more">Show ${Math.min(150,rows.length-UI.limit)} more</button>`:'';
}

function detectRecurring(T){
  const by=new Map();for(const t of T){if(t.kind!=='spend'||t.a<=0)continue;(by.get(t.key)||by.set(t.key,[]).get(t.key)).push(t)}
  const out=[];
  for(const [k,list] of by){
    if(list.length<3)continue;
    const L=[...list].sort((a,b)=>a.d.localeCompare(b.d));
    const gaps=L.slice(1).map((t,i)=>dayNum(t.d)-dayNum(L[i].d)).filter(g=>g>0);if(gaps.length<2)continue;
    const mg=median(gaps);let cad=null;
    if(mg>=6&&mg<=8)cad=['Weekly',7];else if(mg>=13&&mg<=16)cad=['Every 2 weeks',14];else if(mg>=26&&mg<=35)cad=['Monthly',30.4];else if(mg>=85&&mg<=97)cad=['Quarterly',91];else if(mg>=350&&mg<=380)cad=['Yearly',365];
    if(!cad)continue;
    const okG=gaps.filter(g=>Math.abs(g-mg)<=Math.max(4,mg*.35)).length/gaps.length;
    const amts=L.map(t=>t.a);const ma=median(amts.slice(-4));
    const okA=amts.filter(a=>Math.abs(a-ma)<=Math.max(1,ma*.2)).length/amts.length;
    if(okG<.6||okA<.6)continue;
    const last=L[L.length-1];
    const nx=new Date(Date.UTC(1970,0,1)+(dayNum(last.d)+Math.round(cad[1]))*864e5);
    out.push({m:last.m,cat:last.cat,cad:cad[0],amt:ma,last:last.d,next:nx.toISOString().slice(0,10),yearly:ma*365/cad[1],n:L.length});
  }
  return out.sort((a,b)=>b.yearly-a.yearly);
}
function recurringView(T,F,b){
  const R=detectRecurring(filterT(T,null));
  const lastData=T.length?T[0].d:null;
  const monthly=R.reduce((s,r)=>s+r.yearly/12,0);
  const SP=spendParts(F);
  const vis=[...sumBy(SP,t=>t.m,()=>1)].filter(([,n])=>n>=3).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([m,n])=>{const v=SP.filter(t=>t.m===m).reduce((s,t)=>s+t.a,0);const c=SP.find(t=>t.m===m).cat;return {name:m,value:n,valueText:n+' visits',color:colorOf(c),sub:mAuto(v),tip:tipId(`<div class="t-h">${esc(m)}</div>${tipRow('Visits',n)}${tipRow('Spent',mAuto(v))}${tipRow('Per visit',m2(v/n))}`)}});
  return `<div class="grid">
    <div class="card kpi c3"><div class="label">Recurring charges</div><div class="value">${R.length}</div><div class="meta">found in all your statements</div></div>
    <div class="card kpi c3"><div class="label">Per month</div><div class="value">${m0(monthly)}</div><div class="meta">estimated</div></div>
    <div class="card kpi c6"><div class="label">Per year</div><div class="value">${m0(monthly*12)}</div><div class="meta">if every charge keeps going</div></div>
    <section class="card c12"><div class="card-h"><h2>Subscriptions & repeat bills</h2><span class="sub">Same merchant, similar amount, on a steady schedule</span></div>
    ${R.length?`<div class="tbl-wrap"><table><thead><tr><th>Merchant</th><th class="hide-sm">Category</th><th>How often</th><th class="amt">Typical</th><th class="hide-sm">Last charged</th><th class="hide-sm">Next expected</th><th class="amt">Per year</th></tr></thead><tbody>
    ${R.map(r=>{const stale=lastData&&dayNum(lastData)-dayNum(r.next)>10;return `<tr><td><div class="merch"><span class="name">${esc(r.m)}</span><span class="raw">${r.n} charges</span></div></td><td class="hide-sm"><span class="pill"><i class="sw" style="background:${colorOf(r.cat)};width:8px;height:8px;border-radius:50%"></i>${esc(r.cat)}</span></td><td>${r.cad}</td><td class="amt">${m2(r.amt)}</td><td class="date hide-sm">${dLabelY(r.last)}</td><td class="date hide-sm">${stale?'<span class="pill">Possibly stopped</span>':dLabelY(r.next)}</td><td class="amt">${m0(r.yearly)}</td></tr>`}).join('')}
    </tbody></table></div>`:`<p class="muted" style="margin:0">No regular charges found yet. Recurring charges show up once a merchant bills a similar amount at least three times on a steady schedule.</p>`}</section>
    <section class="card c12"><div class="card-h"><h2>Places you keep going back to</h2><span class="sub">Merchants with 3+ visits in this range</span></div>${hbars(vis,{empty:'No merchant has 3 or more visits in this range.'})}</section>
  </div>`;
}

function budgetsView(T,F,b){
  const ms=monthsPresent(filterT(T,null));
  if(!UI.budMonth||!ms.includes(UI.budMonth))UI.budMonth=b.single?b.from:ms[ms.length-1];
  const M=UI.budMonth;const MT=filterT(T,{from:M,to:M}).filter(t=>t.kind==='spend');
  const spent=c=>MT.filter(t=>t.cat===c).reduce((s,t)=>s+t.a,0);
  const B=S.meta.budgets||{};
  const allSp=filterT(T,null).filter(t=>t.kind==='spend');
  const used=new Set(allSp.map(t=>t.cat));
  let totB=0,totS=0;
  const meter=(s,bud)=>{if(!bud)return `<div class="meter"><i style="width:0"></i></div>`;const p=s/bud;const col=p>1?'var(--crit)':p>.85?'var(--warn)':'var(--good)';return `<div class="meter"><i style="width:${Math.min(100,p*100).toFixed(1)}%;background:${col}"></i></div>`};
  const status=(s,bud)=>{if(!bud)return `<span class="muted">${m2(s)} spent</span>`;const left=bud-s;return left>=0?`<span>${m0(s)} of ${m0(bud)}</span><span class="pill ${s/bud>.85?'warn':'good'}">${s/bud>.85?'⚠':'✓'} ${m0(left)} left</span>`:`<span>${m0(s)} of ${m0(bud)}</span><span class="pill crit">✕ Over by ${m0(-left)}</span>`};
  let rows='';
  for(const g of GROUPS){
    const cats=g.cats.filter(c=>UI.showAllCats||used.has(c)||B[c]);if(!cats.length)continue;
    const gs=cats.reduce((s,c)=>s+spent(c),0),gb=cats.reduce((s,c)=>s+(+B[c]||0),0);totB+=gb;totS+=gs;
    rows+=`<div class="grp-h"><i class="sw" style="background:var(${g.c})"></i>${esc(g.name)}<span class="muted" style="font-weight:500;font-size:13px;margin-left:auto">${m0(gs)}${gb?' of '+m0(gb):''}</span></div>`;
    rows+=cats.map(c=>{const s=spent(c),bud=+B[c]||0;return `<div class="bud-row"><div class="name">${esc(c)}</div><div class="m"><div class="top">${status(s,bud)}</div>${meter(s,bud)}</div><label class="money-in"><span>$</span><input id="bud-${esc(c).replace(/[^a-z0-9]/gi,'')}" inputmode="decimal" data-bud="${esc(c)}" value="${bud||''}" placeholder="0" aria-label="Monthly budget for ${esc(c)}"></label></div>`}).join('');
  }
  const unb=MT.reduce((s,t)=>s+t.a,0)-totS;
  return `<div class="grid">
    <section class="card c12"><div class="card-h"><h2>Monthly budgets</h2>
      <div class="controls"><select class="sel" id="budMonth" aria-label="Budget month">${[...ms].reverse().map(m=>`<option value="${m}"${m===M?' selected':''}>${mLabel(m,true)}</option>`).join('')}</select>
      <button class="btn" data-act="suggest">Suggest from my history</button></div></div>
      <div style="display:grid;gap:8px;margin-bottom:6px"><div class="top" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:14px"><span><b style="font-size:20px">${m0(totS+unb)}</b> <span class="muted">spent in ${mLabel(M,true)}${totB?` · ${m0(totB)} budgeted`:''}</span></span>${totB?status(totS,totB):''}</div>${totB?meter(totS,totB):''}</div>
      <p class="fine" style="margin-top:4px">Set a monthly amount for any category. Budgets apply to every month. “Suggest” uses your average over the last 3 months, rounded up to the next $10.</p>
    </section>
    <section class="card c12">${rows}
      <div style="margin-top:14px"><button class="btn ghost" data-act="allcats">${UI.showAllCats?'Show only categories I use':'Show all categories'}</button></div></section>
  </div>`;
}

function statementsView(T){
  const list=Object.entries(stmts()).sort((a,b)=>((b[1].period||{}).end||'').localeCompare((a[1].period||{}).end||''));
  const byId={};for(const t of T)(byId[t.sid]=byId[t.sid]||[]).push(t);
  const rows=list.map(([id,st])=>{
    const tx=st.txns||[];const out=tx.filter(t=>t.a>0).reduce((s,t)=>s+t.a,0),inn=tx.filter(t=>t.a<0).reduce((s,t)=>s-t.a,0);
    const rep=reportedTotals(st.reported);let pill='<span class="pill">No totals to check</span>';
    if(rep&&(rep.out!=null||rep.in!=null)){const dO=rep.out!=null?Math.abs(out-rep.out):0,dI=rep.in!=null?Math.abs(inn-rep.in):0;pill=dO<.01&&dI<.01?'<span class="pill good">✓ Matches statement</span>':`<span class="pill warn">⚠ Off by ${m2(Math.max(dO,dI))}</span>`}
    const p=st.period?`${dLabel(st.period.start)} – ${dLabelY(st.period.end)}`:'';
    return `<tr><td><div class="merch"><span class="name">${esc(st.account||'Account')}</span><span class="raw">${esc(st.name||'')}</span></div></td><td class="date">${p}</td><td class="amt">${tx.length}</td><td class="amt">${m2(out)}</td><td>${pill}</td><td class="hide-sm muted" style="font-size:13px">${st.source==='claude'?'Read by Claude':st.source==='venmo'?'Venmo CSV':st.source==='table'?'Spreadsheet':'Read in page'}</td><td><div class="row-actions">${S.example?'':`<button class="btn ghost danger" data-act="rm" data-id="${id}">Remove</button>`}</div></td></tr>`;
  }).join('');
  return `<div class="grid">
    <section class="card c12"><div class="card-h"><h2>Add more statements</h2><span class="sub">Duplicates are skipped automatically</span></div>${dropZone()}</section>
    <section class="card c12"><div class="card-h"><h2>Your statements</h2><span class="sub">Totals are checked against each statement’s own summary</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>Account</th><th>Period</th><th class="amt">Txns</th><th class="amt">Money out</th><th>Check</th><th class="hide-sm">Source</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="card c12"><div class="card-h"><h2>Privacy & backup</h2><span class="sub">Everything stays on this device</span></div>
      <div class="sec-grid">
        <div><h3>Lock</h3><p>Spend It locks itself after 10 minutes without use. Lock it now when you step away.</p><button class="btn" data-act="lock">Lock now</button></div>
        <div><h3>Backup</h3><p>Your data lives only in this browser. Save an encrypted backup file so you don’t lose it if you clear your browser or switch devices.</p><div class="row-actions" style="justify-content:flex-start"><button class="btn" data-act="export">Save backup</button><button class="btn ghost" data-act="import-pick">Restore backup</button></div></div>
        <form id="passForm" class="pass-row" autocomplete="off"><h3>Change passcode</h3><input class="pass" id="np1" type="password" autocomplete="new-password" placeholder="New passcode" aria-label="New passcode"><input class="pass" id="np2" type="password" autocomplete="new-password" placeholder="Type it again" aria-label="Confirm new passcode"><button class="btn" type="submit">Change passcode</button><p class="lock-err" id="npErr" role="alert"></p></form>
      </div></section>
    ${S.example?'':`<section class="card c12"><div class="card-h"><h2>Start over</h2></div><p class="muted" style="margin:0 0 12px">Remove every statement, category fix and budget from this dashboard.</p><button class="btn danger" data-act="wipe">Delete all my data</button></section>`}
  </div>`;
}

// ================= Upload =================
let sheetOpen=false;const queue=[];
function openSheet(){sheetOpen=true;renderSheet()}
function closeSheet(){sheetOpen=false;const s=$('#sheet');if(s)s.remove();requestRender()}
function renderSheet(){
  if(!sheetOpen)return;let s=$('#sheet');
  if(!s){s=document.createElement('div');s.id='sheet';s.className='sheet-bg';document.body.appendChild(s);s.addEventListener('click',e=>{if(e.target===s&&!queue.some(q=>q.busy))closeSheet()})}
  const busy=queue.some(q=>q.busy);
  s.innerHTML=`<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetT"><div class="sheet-h"><h2 id="sheetT">Add statements</h2><button class="btn ghost" data-act="close-sheet" ${busy?'disabled':''} aria-label="Close">${busy?'Working…':'Done'}</button></div>
    ${dropZone()}
    ${queue.length?`<ul class="queue">${queue.map(q=>`<li><span>${q.busy?'<span class="spin"></span>':q.err?'<span style="color:var(--crit-ink);font-weight:700">✕</span>':q.skip?'<span class="muted">–</span>':'<span style="color:var(--good-ink);font-weight:700">✓</span>'}</span><div style="min-width:0"><div class="fn">${esc(q.name)}</div><div class="st">${esc(q.status)}</div></div><span>${q.pill||''}</span></li>`).join('')}</ul>`:''}
    <p class="fine">PDF statements work best. You can also use CSV or Excel exports. For Venmo, go to venmo.com → Statements and download the CSV. Files are read on this device and never leave it. Fix any category in Transactions and Spend It remembers it for next time.</p></div>`;
  bindDrops();
}
async function handleFiles(files){
  if(UI.lock)return;
  files=[...files].filter(f=>/\.(pdf|csv|xlsx|xls|txt)$/i.test(f.name)||/pdf|csv|sheet|excel/.test(f.type));
  if(!files.length){toast('Choose PDF, CSV or Excel statement files.');return}
  if(S.example){S.example=null}
  if(!sheetOpen)openSheet();
  const items=files.map(f=>({f,name:f.name,status:'Waiting…',busy:true}));queue.unshift(...items.reverse());items.reverse();renderSheet();
  let idx=0;const worker=async()=>{while(idx<items.length){const it=items[idx++];try{await processFile(it)}catch(e){it.err=true;it.status=e&&e.message||'Couldn’t read this file.'}it.busy=false;renderSheet();requestRender()}};
  await Promise.all([worker(),worker()]);
  renderSheet();requestRender();
}
async function processFile(it){
  const f=it.f;const buf=await f.arrayBuffer();const id='s_'+await hashBuf(buf);
  if(S.statements[id]){it.skip=true;it.status='Already added';return}
  const set=(t)=>{it.status=t;renderSheet()};
  let rows=[],account=null,period=null,reported=null,source='parser',header='',holder=null;
  if(/\.pdf$/i.test(f.name)||f.type==='application/pdf'){
    set('Reading PDF…');
    const lines=await pdfLines(buf);const text=lines.join('\n');header=lines.slice(0,40).join('\n');
    if(text.replace(/\s/g,'').length<80)throw new Error('This PDF has no readable text (it may be a scan). Download the statement or a CSV export from your bank instead.');
    period=findPeriod(text);reported=findSummary(text);account=accountFromText(text);holder=holderFromLines(lines);
    rows=heuristicParse(lines,period);
    const rep=reportedTotals(reported);
    const ok=rows.length&&rep&&rep.out!=null&&Math.abs(rows.filter(t=>t.a>0).reduce((s,t)=>s+t.a,0)-rep.out)<.01&&(rep.in==null||Math.abs(rows.filter(t=>t.a<0).reduce((s,t)=>s-t.a,0)-rep.in)<.01);
    if(!ok&&sampleFn){
      set('Reading with Claude (this can take a minute)…');
      try{const x=await aiExtract(lines);if(x.txns.length){rows=x.txns;source='claude';if(x.account)account=x.account;if(x.period)period=x.period;const r=x.reported||{};for(const k in r)if(r[k]!=null&&reported[k]==null)reported[k]=+r[k]}}
      catch(e){if(!rows.length)throw new Error(aiErr(e).replace(', so built-in rules were used','')+' No transactions found.')}
    }
    if(!rows.length)throw new Error('No transactions found in this PDF. Try the CSV export from your bank.');
  }else{
    set('Reading file…');
    let table;
    if(/\.xlsx?$/i.test(f.name)){await loadXLSX();const wb=XLSX.read(buf,{type:'array'});table=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:true,defval:''})}
    else table=parseDelimited(new TextDecoder().decode(buf));
    rows=tableToTxns(table);source=rows.kind==='venmo'?'venmo':'table';holder=rows.holder||null;
    if(!rows.length)throw new Error('No transactions found in this file.');
    const ds=rows.map(r=>r.d).sort();period={start:ds[0],end:ds[ds.length-1]};
    account=rows.account||f.name.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').slice(0,40);
  }
  // categorize
  const need=new Map();
  if(source==='venmo'&&!sampleFn)for(const r of rows)if(!r.c)r.c=venmoCat(r.note,r.who);
  for(const r of rows){if(r.c)continue;const k=rawKey(r.raw);if(S.merchants[k]){r.m=S.merchants[k].m;r.c=S.merchants[k].c}else if(!need.has(k))need.set(k,{key:k,raw:r.raw,a:r.a})}
  let note='';
  if(sampleFn&&(need.size||source==='parser')){
    set(`Categorizing ${need.size} merchants with Claude…`);
    try{const res=await aiCategorize([...need.values()],source==='parser'?header:null);if(res.account&&source==='parser')account=res.account;for(const [k,v] of Object.entries(res.map)){S.merchants[k]=v}}
    catch(e){note=aiErr(e)}
  }
  for(const r of rows){if(!r.c){const k=rawKey(r.raw);const v=S.merchants[k]||(r.venmo?{m:r.m,c:venmoCat(r.note,r.who)}:{m:cleanName(r.raw),c:ruleCat(r.raw,r.a)});if(!S.merchants[k]&&!sampleFn)S.merchants[k]=v;r.m=r.m||v.m;r.c=v.c}}
  const doc={name:f.name,account:account||'Account',...(holder?{holder}:{}),period,reported,source,uploadedAt:new Date().toISOString(),txns:rows.map(r=>({d:r.d,r:String(r.raw).slice(0,120),m:r.m||cleanName(r.raw),a:r.a,c:r.c||'Other'}))};
  S.statements[id]=doc;
  write(id,doc);saveMerchants();
  const rep=reportedTotals(reported);const out=rows.filter(t=>t.a>0).reduce((s,t)=>s+t.a,0),inn=rows.filter(t=>t.a<0).reduce((s,t)=>s-t.a,0);
  if(rep&&rep.out!=null){const d=Math.max(Math.abs(out-rep.out),rep.in!=null?Math.abs(inn-rep.in):0);it.pill=d<.01?'<span class="pill good">✓ Matches</span>':`<span class="pill warn">⚠ Off ${m2(d)}</span>`}
  it.status=`${doc.account} · ${rows.length} transactions${period?' · '+dLabel(period.start)+' – '+dLabelY(period.end):''}${note?' · '+note:''}`;
}

async function sortOther(){
  if(!sampleFn||UI.sorting)return;
  const T=allTxns().filter(t=>t.cat==='Other'&&t.kind==='spend'&&!t.u);
  const need=new Map();for(const t of T){const k=rawKey(t.r||t.m);if(!need.has(k))need.set(k,{key:k,raw:t.r||t.m,a:t.a})}
  if(!need.size)return;
  UI.sorting=true;requestRender();toast(`Claude is looking at ${need.size} merchants. This can take a minute…`);
  try{
    const res=await aiCategorize([...need.values()],null,'complex');
    let moved=0;const touched=new Set();
    for(const [id,st] of Object.entries(stmts())){for(const x of st.txns||[]){if(x.u)continue;const v=res.map[rawKey(x.r||x.m)];if(!v)continue;const nc=legacyCat(x.c,x);if(nc!=='Other'&&!(S.meta.rules[(x.m||'').toLowerCase()]==='Other'))continue;
      if(v.c&&v.c!=='Other'){x.c=v.c;x.m=v.m||x.m;moved++;touched.add(id)}}}
    for(const [k,v] of Object.entries(res.map))S.merchants[k]=v;
    for(const id of touched)write(id,stmts()[id]);saveMerchants();
    toast(moved?`Moved ${moved} transactions out of Other.`:'Claude couldn’t place these either. You can set them by hand in Transactions.');
  }catch(e){toast(e&&e.code==='not_granted'?'Claude access was declined for this page.':'Claude couldn’t finish sorting. Try again in a moment.')}
  UI.sorting=false;requestRender();
}
// ================= Example data =================
function makeExample(){
  let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const now=new Date();const end=new Date(now.getFullYear(),now.getMonth(),0);
  const P=[['Blue Bottle Coffee','Coffee, Tea & Drinks',5,8,14],['Trader Joe\'s','Groceries',35,95,6],['Safeway','Groceries',20,70,3],['Chipotle','Restaurants',11,16,4],['Sushi Ran','Restaurants',40,90,2],['DoorDash','Food Delivery',22,48,5],['Uber','Rideshare & Taxi',9,32,6],['Chevron','Gas & EV Charging',40,62,3],['Amazon','Shopping',12,80,4],['Target','Shopping',20,110,2],['Walgreens','Pharmacy & Health',6,28,2],['The Rusty Tap','Bars & Nightlife',18,55,3],['AMC Theatres','Entertainment',16,32,1]];
  const txns=[];
  for(let mo=2;mo>=0;mo--){
    const y=end.getFullYear(),m=end.getMonth()-mo;const base=new Date(y,m,1);const dim=new Date(y,m+1,0).getDate();
    const D=d=>iso(new Date(base.getFullYear(),base.getMonth(),d));
    for(const [n,c,lo,hi,f] of P){const k=Math.max(0,Math.round(f*(.7+rnd()*.6)));for(let i=0;i<k;i++)txns.push({d:D(1+Math.floor(rnd()*dim)),r:n.toUpperCase(),m:n,a:r2(lo+rnd()*(hi-lo)),c})}
    txns.push({d:D(3),r:'NETFLIX.COM',m:'Netflix',a:15.49,c:'Subscriptions'},{d:D(11),r:'SPOTIFY USA',m:'Spotify',a:11.99,c:'Subscriptions'},{d:D(1),r:'SUNSET APARTMENTS RENT',m:'Sunset Apartments',a:1850,c:'Rent & Housing'},{d:D(18),r:'PG&E WEB ONLINE',m:'PG&E',a:r2(70+rnd()*40),c:'Utilities'},{d:D(22),r:'COMCAST XFINITY',m:'Xfinity',a:65,c:'Phone & Internet'},{d:D(15),r:'ACME CORP PAYROLL',m:'Acme Corp',a:-2600,c:'Income'},{d:D(30>dim?dim:30),r:'ACME CORP PAYROLL',m:'Acme Corp',a:-2600,c:'Income'});
  }
  const ds=txns.map(t=>t.d).sort();
  return {s_example:{name:'example.pdf',account:'Example Card ••0000',period:{start:ds[0],end:ds[ds.length-1]},reported:null,source:'parser',txns}};
}

// ================= Toast =================
let toastT=null;
function toast(msg,action){
  let t=$('#toast');if(t)t.remove();t=document.createElement('div');t.id='toast';t.className='toast';t.setAttribute('role','status');
  t.innerHTML=`<span>${esc(msg)}</span>${action?`<button class="btn" id="toastAct">${esc(action.label)}</button>`:''}`;
  document.body.appendChild(t);if(action)$('#toastAct').onclick=()=>{action.fn();t.remove()};
  clearTimeout(toastT);toastT=setTimeout(()=>t.remove(),action?8000:4000);
}

// ================= Events =================
function setView(v){UI.view=v;UI.limit=150;if(history.replaceState)history.replaceState(null,'','#'+v);requestRender();scrollTo({top:0})}
$('#tabs').addEventListener('click',e=>{const t=e.target.closest('.tab');if(t)setView(t.dataset.v)});
$('#rangeSel').addEventListener('change',e=>{UI.range=e.target.value;ls.set('pb.range',UI.range);UI.budMonth=/^\d{4}-\d{2}$/.test(UI.range)?UI.range:UI.budMonth;requestRender()});
$('#acctSel').addEventListener('change',e=>{UI.acct=e.target.value;requestRender()});
$('#addBtn').addEventListener('click',openSheet);
$('#fileIn').addEventListener('change',e=>{handleFiles(e.target.files);e.target.value=''});
function bindDrops(){}
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-act]');if(!a)return;const act=a.dataset.act;
  if(act==='pick')$('#fileIn').click();
  else if(act==='close-sheet')closeSheet();
  else if(act==='lock')lockNow();
  else if(act==='guide-done'){UI.lock=null;render();window.scrollTo(0,0)}
  else if(act==='export')exportBackup();
  else if(act==='import-pick')$('#impIn').click();
  else if(act==='import-cancel'){pendingImport=null;UI.lock=V.key?null:(readVault()?'unlock':'setup');render()}
  else if(act==='erase'){if(a.dataset.confirm)eraseAll();else{a.dataset.confirm='1';a.textContent='Yes, erase everything on this device';setTimeout(()=>{if(a.isConnected){delete a.dataset.confirm;a.textContent='Erase everything and start over'}},5000)}}
  else if(act==='brush-clear'){UI.selMonths=null;paintSel(null)}
  else if(act==='debt-add'){const D=[...((S.meta&&S.meta.debts)||[])];D.push({name:D.length?'Debt '+(D.length+1):'Credit card',bal:0,apr:24,min:0});S.meta={...S.meta,debts:D};if(!S.example)saveMeta();requestRender();setTimeout(()=>{const n=document.querySelector(`[data-debt="${D.length-1}"][data-f="bal"]`);if(n)n.focus()},80)}
  else if(act==='debt-rm'){const D=[...((S.meta&&S.meta.debts)||[])];D.splice(+a.dataset.i,1);S.meta={...S.meta,debts:D};if(!S.example)saveMeta();requestRender()}
  else if(act==='debt-strat'){S.meta={...S.meta,debtStrat:a.dataset.s};if(!S.example)saveMeta();requestRender()}
  else if(act==='name-edit'){UI.editName=true;requestRender();setTimeout(()=>{const n=$('#nameIn');if(n){n.focus();n.select()}},60)}
  else if(act==='bk-tab'){UI.bkTab=a.dataset.t;requestRender()}
  else if(act==='bd-sort'){UI.bkSort=a.dataset.s;requestRender()}
  else if(act==='bd-vote'){const k=a.dataset.k;const up={...(((S.votes||{})[S.uid]||{}).up||{})};if(up[k])delete up[k];else up[k]=1;S.votes={...S.votes,[S.uid]:{up}};requestRender();boardWrite(()=>S.db.doc('votes/'+S.uid).set({up}))}
  else if(act==='bd-del'){const [uid,id]=a.dataset.k.split(':');const posts=((S.board[uid]||{}).posts||[]).filter(p=>p.id!==id);boardWrite(()=>S.db.doc('board/'+uid).set({posts}))}
  else if(act==='bd-copy'){const [uid,id]=a.dataset.k.split(':');const p=((S.board[uid]||{}).posts||[]).find(x=>x.id===id);if(p){saveBucket([...((S.meta&&S.meta.bucket)||[]),{name:p.text,cost:p.cost||0,done:false}]);toast('Added to your list. Add a cost under My list to see when you can afford it.')}}
  else if(act==='bk-add'){saveBucket([...((S.meta&&S.meta.bucket)||[]),{name:a.dataset.n,cost:+a.dataset.c,done:false}])}
  else if(act==='bk-up'||act==='bk-down'){const B=[...((S.meta&&S.meta.bucket)||[])];const i=+a.dataset.i,j=act==='bk-up'?i-1:i+1;if(j>=0&&j<B.length){[B[i],B[j]]=[B[j],B[i]];saveBucket(B);setTimeout(()=>{const n=document.querySelector(`[data-act="${act}"][data-i="${j}"]`);if(n&&!n.disabled)n.focus()},60)}}
  else if(act==='bk-rm'){const B=[...((S.meta&&S.meta.bucket)||[])];B.splice(+a.dataset.i,1);saveBucket(B)}
  else if(act==='bk-done'){const B=((S.meta&&S.meta.bucket)||[]).map((x,i)=>i===+a.dataset.i?{...x,done:!x.done}:x);saveBucket(B)}
  else if(act==='sort-other')sortOther();
  else if(act==='show-other'){UI.catF='c:Other';UI.kindF='spend';setView('transactions')}
  else if(act==='example'){S.example=makeExample();UI.range='all';requestRender()}
  else if(act==='clear-example'){S.example=null;requestRender()}
  else if(act==='group'){if(a.dataset.g){UI.catF='g:'+a.dataset.g;UI.kindF='spend';UI.q='';setView('transactions')}}
  else if(act==='more'){UI.limit+=150;renderTxTable(filterT(allTxns(),rangeBounds(allTxns())))}
  else if(act==='allcats'){UI.showAllCats=!UI.showAllCats;requestRender()}
  else if(act==='suggest'){
    const T=allTxns().filter(t=>t.kind==='spend');const ms=monthsPresent(T).slice(-3);const sp=sumBy(T.filter(t=>ms.includes(t.d.slice(0,7))),t=>t.cat);
    const B={...(S.meta.budgets||{})};for(const [c,v] of sp){if(v>0)B[c]=Math.ceil(v/ms.length/10)*10}
    S.meta.budgets=B;if(!S.example)saveMeta();requestRender();toast('Budgets set from your last '+ms.length+' months.');
  }
  else if(act==='rm'){
    if(a.dataset.confirm){const id=a.dataset.id;delete S.statements[id];write(id,null);requestRender();toast('Statement removed.')}
    else{a.dataset.confirm='1';a.textContent='Confirm remove';setTimeout(()=>{if(a.isConnected){delete a.dataset.confirm;a.textContent='Remove'}},4000)}
  }
  else if(act==='wipe'){
    if(a.dataset.confirm){persistSoon();for(const id of Object.keys(S.statements))write(id,null);write('meta',null);write('merchants',null);S.statements={};S.meta={rules:{},budgets:{}};S.merchants={};UI.view='overview';requestRender();toast('All data deleted.')}
    else{a.dataset.confirm='1';a.textContent='Yes, delete everything';setTimeout(()=>{if(a.isConnected){delete a.dataset.confirm;a.textContent='Delete all my data'}},5000)}
  }
});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.drop')){e.preventDefault();$('#fileIn').click()}if(e.key==='Escape'&&sheetOpen&&!queue.some(q=>q.busy))closeSheet()});
document.addEventListener('input',e=>{

  if(e.target.id==='txSearch'){UI.q=e.target.value;UI.limit=150;renderTxTable(filterT(allTxns(),rangeBounds(allTxns())))}
});
let budT=null;
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='txCat'){UI.catF=el.value;UI.limit=150;renderTxTable(filterT(allTxns(),rangeBounds(allTxns())))}
  else if(el.id==='txKind'){UI.kindF=el.value;UI.limit=150;renderTxTable(filterT(allTxns(),rangeBounds(allTxns())))}
  else if(['goalIn','savedIn','incomeIn','retIn'].includes(el.id)){const v=parseFloat(el.value.replace(/[^\d.\-]/g,''));const k={goalIn:'goal',savedIn:'saved',incomeIn:'income',retIn:'ret'}[el.id];S.meta={...S.meta,[k]:isFinite(v)?v:0};if(!S.example)saveMeta();pendingRender=false;requestRender()}
  else if(el.dataset&&el.dataset.bkcost!=null){const v=parseFloat(el.value.replace(/[^\d.]/g,''));if(v>0){const B=((S.meta&&S.meta.bucket)||[]).map((x,i)=>i===+el.dataset.bkcost?{...x,cost:v}:x);saveBucket(B)}}
  else if(el.dataset&&el.dataset.debt!=null){const D=[...((S.meta&&S.meta.debts)||[])];const i=+el.dataset.debt,f=el.dataset.f;if(D[i]){D[i]={...D[i],[f]:f==='name'?el.value.slice(0,40):(parseFloat(el.value.replace(/[^\d.]/g,''))||0)};S.meta={...S.meta,debts:D};if(!S.example)saveMeta();pendingRender=true}}
  else if(el.id==='debtExtra'){const v=parseFloat(el.value.replace(/[^\d.]/g,''));S.meta={...S.meta,debtExtra:isFinite(v)?v:0};if(!S.example)saveMeta();pendingRender=false;requestRender()}
  else if(el.id==='saveIn'){const v=parseFloat(el.value.replace(/[^\d.]/g,''));S.meta={...S.meta,saveAmt:isFinite(v)?v:0};if(!S.example)saveMeta();pendingRender=false;requestRender()}
  else if(el.id==='rentIn'){const v=parseFloat(el.value.replace(/[^\d.]/g,''));S.meta={...S.meta,rent:isFinite(v)?v:0};if(!S.example)saveMeta();requestRender()}
  else if(el.id==='budMonth'){UI.budMonth=el.value;requestRender()}
  else if(el.dataset.bud!=null){const v=parseFloat(el.value.replace(/[^\d.]/g,''));const B={...(S.meta.budgets||{})};if(v>0)B[el.dataset.bud]=v;else delete B[el.dataset.bud];S.meta.budgets=B;if(!S.example){clearTimeout(budT);budT=setTimeout(saveMeta,500)}pendingRender=true}
  else if(el.dataset.tx){
    const [sid,i]=el.dataset.tx.split(':');const st=stmts()[sid];if(!st)return;const t=st.txns[+i];const cat=el.value;
    const prevCat=t.c,prevU=t.u;t.c=cat;t.u=1;if(!S.example)write(sid,st);
    const key=(t.m||'').toLowerCase();const same=allTxns().filter(x=>x.key===key&&x.cat!==cat);
    renderTxTable(filterT(allTxns(),rangeBounds(allTxns())));
    if(same.length)toast(`Moved to ${cat}.`,{label:`Apply to all ${same.length+1} from ${t.m}`,fn:()=>{
      S.meta.rules={...S.meta.rules,[key]:cat};
      for(const [id,s] of Object.entries(stmts())){let ch=false;for(const x of s.txns||[])if((x.m||'').toLowerCase()===key&&x.u){delete x.u;x.c=cat;ch=true}if(ch&&!S.example)write(id,s)}
      if(!S.example)saveMeta();requestRender();toast(`All ${t.m} transactions are now ${cat}, including future ones.`)}});
    else toast(`Moved to ${cat}.`);
  }
});
// drag and drop anywhere
let dragDepth=0;
addEventListener('dragenter',e=>{if([...(e.dataTransfer&&e.dataTransfer.types||[])].includes('Files')){dragDepth++;document.querySelectorAll('.drop').forEach(d=>d.classList.add('over'))}});
addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)document.querySelectorAll('.drop').forEach(d=>d.classList.remove('over'))});
addEventListener('dragover',e=>{e.preventDefault()});
addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.querySelectorAll('.drop').forEach(d=>d.classList.remove('over'));if(e.dataTransfer&&e.dataTransfer.files.length)handleFiles(e.dataTransfer.files)});

// ================= Theme switch =================
(function(){const mq=matchMedia('(prefers-color-scheme: dark)');const sw=$('#themeSw');
  const apply=pref=>{if(pref)document.documentElement.setAttribute('data-theme',pref);sw.checked=pref?pref==='dark':mq.matches};
  apply(ls.get('pb.theme'));
  sw.addEventListener('change',()=>{const t=sw.checked?'dark':'light';ls.set('pb.theme',t);document.documentElement.setAttribute('data-theme',t);requestRender()});
  mq.addEventListener&&mq.addEventListener('change',()=>{if(!ls.get('pb.theme'))sw.checked=mq.matches});
})();
// ================= Boot =================
{const h=(location.hash||'').slice(1);if(['overview','transactions','recurring','statements'].includes(h))UI.view=h}
render();
initStore();
let rzT=null,lastW=innerWidth;addEventListener('resize',()=>{if(Math.abs(innerWidth-lastW)<40)return;clearTimeout(rzT);rzT=setTimeout(()=>{lastW=innerWidth;if(UI.view==='overview')requestRender()},200)});

function guideView(){
  const step=(n,t,d)=>`<li><span class="n">${n}</span><span><b>${t}</b> ${d}</span></li>`;
  const w=(ic,t,d)=>`<div><span aria-hidden="true">${ic}</span><div><b>${t}</b> ${d}</div></div>`;
  return `<section class="card guide" aria-labelledby="gT"><h2 id="gT">Getting started</h2><p class="lede">Six steps to see where your money goes.</p>
  <ol class="g-steps">
  ${step(1,'Download your statements.','Log into each bank, credit card and debit card account, plus Venmo, and download your statements. PDF, CSV and Excel all work. Most banks keep them under “Statements” or “Documents.” For Venmo, go to venmo.com → Statements and download the CSV. The more months you add, the better your averages; 6 to 12 months works best.')}
  ${step(2,'Add them here.','Click <b>Add statements</b> and drop them all in at once. They’re read right here on your computer and never uploaded.')}
  ${step(3,'Check that the numbers match.','Open the <b>Statements</b> tab. Each statement shows whether its total matches what the bank reported. If one doesn’t match, compare it with your real statement.')}
  ${step(4,'Fix any wrong categories.','In <b>Transactions</b>, click a category to change it. Spend It remembers the merchant, so the fix applies everywhere.')}
  ${step(5,'Explore.','See where your money goes, your habits, your recurring charges and your projected savings.')}
  ${step(6,'Save a backup.','In the <b>Statements</b> tab, click <b>Save backup</b> to download an encrypted copy, and do it again after adding new statements.')}
  </ol>
  <h3>Before you start</h3>
  <div class="g-warn">
  ${w('💻','Spend It is made for computers.','Use it in Chrome, Edge, Firefox or Safari on a laptop or desktop. It opens on phones, but downloading statements and reading the charts is much easier on a bigger screen.')}
  ${w('⚠️','Write down your passcode.','There’s no “forgot passcode.” Nobody can reset it, including whoever runs this site. Lose it and your data is gone unless you have a backup.')}
  ${w('⚠️','Your data lives only in this browser, on this computer.','<ul><li>Clearing your browsing history or site data erases it.</li><li>Private or incognito mode erases it when you close the window.</li><li>On a new computer, restore a backup to bring it over.</li></ul>')}
  ${w('⚠️','Only download statements from your bank’s real website or app,','and only use Spend It at this exact link. Ignore copies at other addresses.')}
  ${w('⚠️','Don’t use it on shared or public computers.','Click <b>Lock</b> when you’re done. It also locks itself after 10 minutes.')}
  ${w('⚠️','Keep your backup file somewhere safe.','It’s encrypted, but treat it like any other financial document.')}
  ${w('🔒','Could my info leak?','<ul><li><b>Nothing is uploaded.</b> Your statements are read on your computer, and the site is blocked from sending data anywhere.</li><li><b>Your data is encrypted</b> with your passcode and saved only in this browser. Without the passcode, nobody can read it, including whoever runs this site.</li><li><b>The remaining risks are on your own computer:</b> a virus, a malicious browser extension, or someone using it while Spend It is unlocked. These are the same risks you take when you log into your bank’s website.</li></ul>')}
  ${w('ℹ️','Categories are automatic best guesses.','Spend It is a tool to see your spending, not financial advice.')}
  </div>
  <div class="g-go"><button class="btn primary" data-act="guide-done">${Object.keys(S.statements||{}).length?'Back to my dashboard':'Got it, let’s start'}</button></div></section>`}
function importView(){return `<section class="card lock"><div class="lock-ic" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 10l5 5 5-5M4 19h16"/></svg></div>
  <h2>Restore backup</h2><p class="lede">Enter the passcode that was used when this backup was saved. It will replace what’s on this device.</p>
  <form id="importForm" class="lock-form" autocomplete="off"><input class="pass" id="impPass" type="password" placeholder="Backup passcode" aria-label="Backup passcode" required>
  <button class="btn primary" type="submit">Restore</button><p class="lock-err" id="impErr" role="alert"></p></form>
  <p class="fine"><button class="linkish" type="button" data-act="import-cancel">Cancel</button></p></section>`}
$('#impIn').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const v=JSON.parse(await f.text());if(!v||v.app!=='pocketbook'||!v.ct)throw 0;pendingImport=v;UI.lock='import';render()}
  catch(x){toast('That file isn’t a Spend It backup.')}
});
$('#lockBtn').addEventListener('click',()=>lockNow());
$('#helpBtn').addEventListener('click',()=>{if(!V.key)return;if(typeof sheetOpen!=='undefined'&&sheetOpen)closeSheet();UI.lock='guide';render()});
document.addEventListener('submit',async e=>{
  if(e.target.id!=='passForm')return;e.preventDefault();
  const a=$('#np1').value,b=$('#np2').value,err=$('#npErr');err.textContent='';
  if(a.length<6){err.textContent='Use at least 6 characters.';return}
  if(a!==b){err.textContent='Those two passcodes don’t match.';return}
  await changePasscode(a);$('#np1').value=$('#np2').value='';toast('Passcode changed. Old backups still open with the old passcode.');
});
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
