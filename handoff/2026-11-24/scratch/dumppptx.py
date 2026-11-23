import sys
from pptx import Presentation
p=Presentation(sys.argv[1])
for i,s in enumerate(p.slides,1):
    hid=s._element.get('show')=='0'
    texts=[]
    pics=0
    for sh in s.shapes:
        if sh.shape_type==13: pics+=1
        if sh.has_text_frame and sh.text_frame.text.strip(): texts.append(sh.text_frame.text.strip().replace('\n',' / ')[:110])
    n=s.notes_slide.notes_text_frame.text if s.has_notes_slide else ''
    print(f"--- {i} hidden={hid} pics={pics}")
    for t in texts[:6]: print("   T:",t)
    if n: print("   NOTES:",n[:400].replace('\n',' | '))
