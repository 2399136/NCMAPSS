import h5py

# 파일 경로를 본인의 파일명으로 수정하세요
FILE_PATH = 'C:\Users\LEE\Desktop\UNIV\4-2\BigdataAI\data_set\data_set\N-CMAPSS_DS08a-009.h5' 

try:
    with h5py.File(FILE_PATH, 'r') as f:
        print(f"📂 파일 이름: {FILE_PATH}")
        print("-" * 30)
        print("🔑 포함된 키(Keys) 목록:")
        
        # 최상위 키 출력
        for key in f.keys():
            print(f"  - {key}")
            # 만약 그룹이라면 내부 데이터 쉐이프도 확인
            item = f[key]
            if isinstance(item, h5py.Dataset):
                print(f"    📏 형태(Shape): {item.shape}, 타입: {item.dtype}")
            elif isinstance(item, h5py.Group):
                print(f"    📂 그룹입니다 (내부 키: {list(item.keys())})")
                
    print("-" * 30)
    print("✅ 위 목록 중 실제 센서 데이터(X)와 라벨(Y)이 담긴 키 이름을 기억해두세요.")
    
except FileNotFoundError:
    print("❌ 파일을 찾을 수 없습니다. 경로를 확인해주세요.")
except Exception as e:
    print(f"❌ 오류 발생: {e}")