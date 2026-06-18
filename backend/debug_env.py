from pathlib import Path
from dotenv import dotenv_values

p = Path('.env')
print('cwd=', p.parent.resolve())
print('exists=', p.exists())
text = p.read_text(encoding='utf-8')
print('len=', len(text))
print('find DATABASE_URL=', text.find('DATABASE_URL'))
print('repr snippet=', repr(text[text.find('DATABASE_URL'):text.find('DATABASE_URL')+120]))
print('parsed DATABASE_URL=', dotenv_values(p).get('DATABASE_URL'))
print('all keys=', sorted(dotenv_values(p).keys()))
