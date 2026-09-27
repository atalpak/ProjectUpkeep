import base64, hashlib, hmac, json, time, urllib.request, urllib.parse
SECRET=b'upkeep-local-contract-only-not-production-2026'
CARD='de000000-0000-0000-0000-000000000010'
OWNER='de000000-0000-0000-0000-000000000001'
OTHER='de000000-0000-0000-0000-000000000002'
def token(role, sub=OWNER):
    enc=lambda d:base64.urlsafe_b64encode(json.dumps(d,separators=(',',':')).encode()).rstrip(b'=')
    body=enc({'alg':'HS256','typ':'JWT'})+b'.'+enc({'role':role,'sub':sub,'exp':int(time.time())+600})
    return (body+b'.'+base64.urlsafe_b64encode(hmac.new(SECRET,body,hashlib.sha256).digest()).rstrip(b'=')).decode()
def get(path, query, role='authenticated', sub=OWNER):
    url='http://127.0.0.1:3009/'+path+'?'+urllib.parse.urlencode(query)
    req=urllib.request.Request(url,headers={'Authorization':'Bearer '+token(role,sub)})
    with urllib.request.urlopen(req) as response:return json.load(response)
def check(condition,msg):
    if not condition:raise AssertionError(msg)
    print('PASS',msg)
rows=get('cards',{'select':'scryfall_id,name','scryfall_id':'eq.'+CARD},'anon')
check(len(rows)==1 and rows[0]['name']=='Contract Card','anonymous direct cards compatibility read')
for table in ['card_instances','deck_cards','want_list','trade_items']:
    for embedding in ['cards(scryfall_id,name)','cards!inner(scryfall_id,name)']:
        rows=get(table,{'select':'id,'+embedding,'card_id':'eq.'+CARD})
        check(len(rows)==1 and isinstance(rows[0]['cards'],dict) and rows[0]['cards']['scryfall_id']==CARD,table+' '+embedding+' retains to-one object')
    if table!='trade_items':
        check(get(table,{'select':'id,cards(scryfall_id,name)','card_id':'eq.'+CARD},sub=OTHER)==[],table+' hides other owner rows')
rows=get('card_instances',{'select':'id,cards!inner(scryfall_id,name)','card_id':'eq.'+CARD,'cards.name':'eq.Contract Card'})
check(len(rows)==1,'embedded cards filter on compatibility view')
rows=get('card_instances',{'select':'id,cards!inner(scryfall_id,name)','card_id':'eq.'+CARD,'cards.name':'eq.Missing Card'})
check(rows==[],'inner embed prunes unmatched child rows')
for embedding in ['commander:cards!commander_card_id(scryfall_id,name)','commander:cards(scryfall_id,name)']:
    rows=get('locations',{'select':'id,'+embedding,'id':'eq.de000000-0000-0000-0000-000000000020'})
    check(len(rows)==1 and isinstance(rows[0]['commander'],dict) and rows[0]['commander']['scryfall_id']==CARD,'locations '+embedding+' retains to-one object')
check(get('card_instances',{'select':'id,cards(scryfall_id)','card_id':'eq.'+CARD},'anon')==[],'anonymous collection remains private')
print('All compatibility API contract checks passed.')
def post(path, payload, role):
    req=urllib.request.Request('http://127.0.0.1:3009/'+path,data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+token(role),'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as exc:return exc.code,json.load(exc)
for role in ['anon','authenticated']:
    status,payload=post('rpc/ingest_card_printings',{'p_rows':[]},role)
    check(status in (401,403,404),'ingest RPC denied to '+role)
status,payload=post('rpc/ingest_card_printings',{'p_rows':[]},'service_role')
check(status==200 and payload==0,'service-role empty ingest executes through RPC')
fields={'mana_cost':'{1}{G}','cmc':2,'type_line':'Creature — Elf','oracle_text':'Contract rules','colors':['G'],'color_identity':['G'],'keywords':[],'power':'2','toughness':'2','loyalty':None,'produced_mana':['G'],'game_changer':False,'layout':'normal'}
status,payload=post('rpc/ingest_card_printings',{'p_rows':[dict(fields,scryfall_id=CARD,oracle_id=None)],'p_write':False},'service_role')
check(status==200 and payload==0,'service-role refresh-only ingest stores orphan shared fallback')
rows=get('cards',{'select':'*','scryfall_id':'eq.'+CARD},'anon')
check(all(rows[0][k]==v for k,v in fields.items()),'anonymous cards shared field projection preserves arrays and explicit nulls')
rows=get('card_instances',{'select':'id,cards!inner(scryfall_id,oracle_text,colors,loyalty)','card_id':'eq.'+CARD})
check(rows[0]['cards']['oracle_text']=='Contract rules' and rows[0]['cards']['colors']==['G'] and rows[0]['cards']['loyalty'] is None,'embedded shared projections preserve rules, arrays and nulls')
for role in ['anon','authenticated','service_role']:
    status,payload=post('card_printings',{'scryfall_id':'de000000-0000-0000-0000-000000000090','name':'Prohibited','set_code':'tst','collector_number':'90'},role)
    check(status in (401,403),'direct physical printing insertion denied to '+role)
print('Extended catalog projection and RPC authorization checks passed.')
