import wave, array, math, sys
for f in sys.argv[1:]:
    w = wave.open(f); sr = w.getframerate(); a = array.array('h', w.readframes(w.getnframes()))
    win = int(sr*0.1); out=[]; zc=[]
    for i in range(0, len(a)-win+1, win):
        seg = a[i:i+win]; rms = math.sqrt(sum(x*x for x in seg)/win) or 1
        db = 20*math.log10(rms/32768); z = sum(1 for k in range(1,win) if (seg[k-1]<0)!=(seg[k]<0))/ (win/sr)
        out.append(round(db)); zc.append(int(z))
    print(f.split('/')[-1], 'dBFS per 0.1s:', ' '.join(map(str,out)))
    print('   zero-cross/s:', ' '.join(map(str,zc)))
