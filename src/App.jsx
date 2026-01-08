import React, { useState, useEffect, useRef, Suspense, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell } from 'recharts';
import { AlertTriangle, CheckCircle, Activity, RefreshCw, Play, Pause, Server, Wind, Plane, Cpu, MousePointer2, Flame } from 'lucide-react';

// --- 시뮬레이션 데이터 생성 로직 ---
const TOTAL_CYCLES = 200;
const DANGER_THRESHOLD = 10;
const MAX_RUL = 30;

const generateSimulationData = () => {
  const data = [];
  for (let i = 0; i <= TOTAL_CYCLES; i++) {
    let rul = MAX_RUL;
    if (i > 50) {
      const degradation = (i - 50) * 0.2;
      rul = Math.max(0, MAX_RUL - degradation + (Math.random() * 2 - 1));
    }

    const baseHealth = 0.001;
    const globalAging = i > 30 ? (i - 30) * 0.000025 : 0;
    const fanFailureTrend = i > 100 ? ((i - 100) / 100) * 0.015 : 0;

    const valFan = baseHealth + globalAging + fanFailureTrend + Math.random() * 0.0005;
    const valLPC = baseHealth + (globalAging * 1.5) + Math.random() * 0.0005;
    const valHPC = baseHealth + (globalAging * 1.3) + Math.random() * 0.0005;
    const valHPT = baseHealth + globalAging + Math.random() * 0.0005;
    const valLPT = baseHealth + globalAging + Math.random() * 0.0005;

    data.push({
      cycle: i,
      rul: Number(rul.toFixed(2)),
      components: [
        { key: 'Fan', name: 'Fan (팬)', value: valFan, alert: valFan > 0.008 },
        { key: 'LPC', name: 'LPC (저압압축)', value: valLPC, alert: false },
        { key: 'HPC', name: 'HPC (고압압축)', value: valHPC, alert: false },
        { key: 'HPT', name: 'HPT (고압터빈)', value: valHPT, alert: false },
        { key: 'LPT', name: 'LPT (저압터빈)', value: valLPT, alert: false },
      ]
    });
  }
  return data;
};

const SIMULATION_DATA = generateSimulationData();

// --- 3D Airflow Visualization Component ---
const AirflowParticles = ({ isPlaying }) => {
  const count = 4000; // 파티클 개수 증가 (밀도 향상)
  const mesh = useRef();
  
  // 초기 위치와 속도 설정
  const particles = useMemo(() => {
    const tempPositions = new Float32Array(count * 3);
    const tempColors = new Float32Array(count * 3);
    const tempSeeds = new Float32Array(count); // 각 파티클의 고유 오프셋

    for (let i = 0; i < count; i++) {
      // [수정됨] 초기 위치를 엔진 전체 길이(-10 ~ 6)에 걸쳐 고르게 분포시켜 끊김 방지
      const x = (Math.random() * 16) - 10; 
      
      // 해당 x 위치에서의 엔진 반경 계산 (초기 위치가 엔진 형상을 따르도록 함)
      let targetRadius = 1.5;
      if (x > 2.5) targetRadius = 1.6; // Fan
      else if (x > 0.5) targetRadius = 1.2 - (2.5 - x) * 0.4; // Compressor
      else if (x > -0.5) targetRadius = 0.5; // Combustor
      else if (x > -3.0) targetRadius = 0.5 + Math.abs(x + 0.5) * 0.3; // Turbine
      else targetRadius = 1.0; // Exhaust

      // 타겟 반경 내에서 무작위 위치 선정
      const r = Math.random() * targetRadius; 
      const theta = Math.random() * Math.PI * 2;
      
      const y = r * Math.cos(theta);
      const z = r * Math.sin(theta);

      tempPositions[i * 3] = x;
      tempPositions[i * 3 + 1] = y;
      tempPositions[i * 3 + 2] = z;

      tempSeeds[i] = Math.random();

      // 초기 색상 설정 (위치에 따라 Cold/Hot 미리 적용)
      if (x > 0) {
        // Cold Section (Blue/White)
        tempColors[i * 3] = 0.6; 
        tempColors[i * 3 + 1] = 0.8; 
        tempColors[i * 3 + 2] = 1.0; 
      } else {
        // Hot Section (Red/Orange)
        const progress = Math.min(1, Math.abs(x) / 4);
        tempColors[i * 3] = 1.0; 
        tempColors[i * 3 + 1] = 0.6 * (1 - progress); 
        tempColors[i * 3 + 2] = 0.1; 
      }
    }
    return { positions: tempPositions, colors: tempColors, seeds: tempSeeds };
  }, []);

  useFrame((state, delta) => {
    if (!isPlaying) return;

    const positions = mesh.current.geometry.attributes.position.array;
    const colors = mesh.current.geometry.attributes.color.array;
    const speed = delta * 12; // 공기 속도

    for (let i = 0; i < count; i++) {
      let x = positions[i * 3];
      let y = positions[i * 3 + 1];
      let z = positions[i * 3 + 2];
      
      // X축 이동 (뒤로 이동)
      x -= speed;

      // === 위치 리셋 로직 (순환) ===
      if (x < -8) { // 끝부분(-8)을 지나면 다시 앞으로 보냄
        x = 4.5 + Math.random() * 1.5; // Fan 앞에서 재등장
        // 리셋 시 Y, Z를 넓게 퍼트림 (Intake 크기)
        const r = Math.random() * 1.6;
        const theta = Math.random() * Math.PI * 2;
        y = r * Math.cos(theta);
        z = r * Math.sin(theta);
      }

      // === 엔진 형상에 따른 유체 수축/팽창 로직 ===
      // 현재 중심축으로부터의 거리
      const currentRadius = Math.sqrt(y*y + z*z);
      let targetRadius = 1.5;

      // 구간별 압축/팽창 비율 정의
      if (x > 2.5) targetRadius = 1.6; // Fan
      else if (x > 0.5) targetRadius = 1.2 - (2.5 - x) * 0.4; // Compressor (압축)
      else if (x > -0.5) targetRadius = 0.5; // Combustor (최대 압축)
      else if (x > -3.0) targetRadius = 0.5 + Math.abs(x + 0.5) * 0.3; // Turbine (팽창)
      else targetRadius = 1.0; // Exhaust

      // 부드럽게 반지름 조정 (Squeeze effect)
      // 입자가 목표 반경보다 밖에 있거나 너무 중심에 몰려있으면 조정
      if (currentRadius > targetRadius || (currentRadius < targetRadius * 0.2 && x > -4)) {
         // 목표 반지름으로 서서히 이동
         const angle = Math.atan2(z, y);
         // 약간의 난기류(Turbulence) 추가하여 자연스럽게
         const noise = Math.sin(x * 10 + state.clock.elapsedTime * 5) * 0.05;
         // 목표 반경의 80% 지점을 중심으로 모이도록 유도
         const newR = targetRadius * (0.8 + particles.seeds[i] * 0.4) + noise; 
         
         // 급격한 변화 방지를 위한 보간 (Lerp)
         const lerpFactor = 0.1; 
         y = y + (newR * Math.cos(angle) - y) * lerpFactor;
         z = z + (newR * Math.sin(angle) - z) * lerpFactor;
      }

      // === 색상 변화 로직 (온도 시각화) ===
      if (x > 0) {
        // Cold Section (Blue/White)
        colors[i * 3] = 0.6; // R
        colors[i * 3 + 1] = 0.8; // G
        colors[i * 3 + 2] = 1.0; // B
      } else {
        // Hot Section (Red/Orange/Yellow) - 연소실(x=0) 지나면 색 변함
        // 거리에 따라 빨강 -> 주황 -> 투명 변화
        const progress = Math.min(1, Math.abs(x) / 4);
        colors[i * 3] = 1.0; // R (Full Red)
        colors[i * 3 + 1] = 0.6 * (1 - progress); // G (Green 줄어듦 -> 붉어짐)
        colors[i * 3 + 2] = 0.1; // B (Low)
      }

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    mesh.current.geometry.attributes.position.needsUpdate = true;
    mesh.current.geometry.attributes.color.needsUpdate = true;
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={particles.positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={count}
          array={particles.colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.05} // 입자 크기 약간 축소하여 더 부드럽게
        vertexColors
        transparent
        opacity={0.6}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};


// --- 3D Realistic Blade Logic ---

const useBladeGeometry = (width, height, twistFactor = 1) => {
  return useMemo(() => {
    const chordLength = width;
    const bladeHeight = height;
    const thickness = width * 0.15;
    const segmentsW = 6;
    const segmentsH = 10;

    const geometry = new THREE.BoxGeometry(chordLength, bladeHeight, thickness, segmentsW, segmentsH);
    const positions = geometry.attributes.position;
    const vector = new THREE.Vector3();

    for (let i = 0; i < positions.count; i++) {
      vector.fromBufferAttribute(positions, i);
      const yRatio = (vector.y + bladeHeight / 2) / bladeHeight;
      const taperFactor = 1.0 - (yRatio * 0.3); 
      vector.x *= taperFactor;
      const twistAngle = -Math.PI / 3 * yRatio * twistFactor;
      const cos = Math.cos(twistAngle);
      const sin = Math.sin(twistAngle);
      const x = vector.x;
      const z = vector.z;
      vector.x = x * cos - z * sin;
      vector.z = x * sin + z * cos;
      vector.z += Math.sin(x * 3) * 0.05 * taperFactor;
      positions.setXYZ(i, vector.x, vector.y, vector.z);
    }
    geometry.computeVertexNormals();
    return geometry;
  }, [width, height, twistFactor]);
};

const SingleBlade = ({ geometry, materialProps, position, rotation, scale }) => {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geometry} position={[0, geometry.parameters.height / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial {...materialProps} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[geometry.parameters.width * 0.9, geometry.parameters.width * 0.1, geometry.parameters.width * 0.5]} />
        <meshStandardMaterial color="#222" roughness={0.9} />
      </mesh>
    </group>
  );
};

const RealisticTurbineStage = ({ position, rotation, numBlades, discRadius, bladeHeight, bladeWidth, color, speed, isPlaying, alert, twistDirection = 1 }) => {
  const groupRef = useRef();
  const bladeGeo = useBladeGeometry(bladeWidth || discRadius * 0.3, bladeHeight, twistDirection);

  useFrame((state, delta) => {
    if (isPlaying && groupRef.current) {
      groupRef.current.rotation.x += delta * speed * (twistDirection > 0 ? -1 : 1);
    }
  });

  const materialProps = {
    color: alert ? '#ef4444' : color,
    metalness: 0.8,
    roughness: 0.3,
    emissive: alert ? '#ef4444' : '#000000',
    emissiveIntensity: alert ? 0.5 : 0,
    side: THREE.DoubleSide
  };

  return (
    <group position={position} rotation={rotation}>
      <group ref={groupRef}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[discRadius * 0.9, discRadius * 0.9, 0.2, 32]} />
          <meshStandardMaterial color="#333" metalness={0.7} roughness={0.6} />
        </mesh>
        {Array.from({ length: numBlades }).map((_, i) => {
          const angle = (i / numBlades) * Math.PI * 2;
          const radius = discRadius * 0.85;
          const y = Math.cos(angle) * radius; 
          const z = Math.sin(angle) * radius; 
          return (
            <SingleBlade
              key={i}
              geometry={bladeGeo}
              materialProps={materialProps}
              position={[0, y, z]} 
              rotation={[angle, 0, 0]} 
              scale={[1, 1, 1]}
            />
          );
        })}
      </group>
    </group>
  );
};

// 전체 엔진 조립
const TurbofanEngine3D = ({ components, isPlaying }) => {
  const getStatus = (key) => components.find(c => c.key === key)?.alert || false;

  return (
    <group>
      {/* Airflow Particles Effect */}
      <AirflowParticles isPlaying={isPlaying} />

      {/* === 1. FAN SECTION === */}
      <mesh position={[4.5, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.75, 1.8, 32]} />
        <meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.3} />
      </mesh>

      <RealisticTurbineStage
        position={[3.5, 0, 0]}
        rotation={[0, 0, 0]} 
        numBlades={24}
        discRadius={1.8}
        bladeHeight={1.6}
        bladeWidth={0.6}
        color="#38bdf8" 
        speed={4}
        isPlaying={isPlaying}
        alert={getStatus('Fan')}
        twistDirection={1}
      />

      <mesh position={[3.0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[3.6, 3.6, 3.5, 48, 1, true]} />
        <meshStandardMaterial color="#fff" opacity={0.1} transparent side={THREE.DoubleSide} wireframe={false} />
      </mesh>
      <mesh position={[3.0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
         <cylinderGeometry args={[3.62, 3.62, 3.5, 24, 1, true]} />
         <meshBasicMaterial color="#38bdf8" opacity={0.2} transparent wireframe />
      </mesh>


      {/* === 2. COMPRESSOR SECTION (LPC -> HPC) === */}
      <RealisticTurbineStage position={[2.5, 0, 0]} rotation={[0, 0, 0]} numBlades={18} discRadius={1.3} bladeHeight={0.9} bladeWidth={0.35} color="#94a3b8" speed={4} isPlaying={isPlaying} alert={getStatus('LPC')} />
      <RealisticTurbineStage position={[2.1, 0, 0]} rotation={[0, 0, 0]} numBlades={20} discRadius={1.2} bladeHeight={0.8} bladeWidth={0.32} color="#94a3b8" speed={4} isPlaying={isPlaying} alert={getStatus('LPC')} />

      {[1.6, 1.3, 1.0, 0.7].map((xPos, i) => (
        <RealisticTurbineStage
          key={`hpc-${i}`}
          position={[xPos, 0, 0]}
          rotation={[0, 0, 0]}
          numBlades={24 + i * 2}
          discRadius={0.9 - i * 0.05}
          bladeHeight={0.6 - i * 0.05}
          bladeWidth={0.25}
          color="#cbd5e1"
          speed={7} 
          isPlaying={isPlaying}
          alert={getStatus('HPC')}
        />
      ))}


      {/* === 3. COMBUSTION CHAMBER === */}
      <group position={[0, 0, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.95, 0.9, 1.2, 24]} />
          <meshStandardMaterial 
            color="#7f1d1d" 
            emissive="#ea580c" 
            emissiveIntensity={isPlaying ? 1.5 : 0.5} 
            metalness={0.5} 
          />
        </mesh>
        <pointLight intensity={isPlaying ? 4 : 1} color="#ff4500" distance={5} decay={2} />
      </group>


      {/* === 4. TURBINE SECTION (HPT -> LPT) === */}
      <RealisticTurbineStage 
        position={[-0.8, 0, 0]} 
        rotation={[0, 0, 0]} 
        numBlades={30} 
        discRadius={0.9} 
        bladeHeight={0.65} 
        bladeWidth={0.28} 
        color="#fb7185" 
        speed={7} 
        isPlaying={isPlaying} 
        alert={getStatus('HPT')} 
        twistDirection={-1} 
      />

      {[-1.4, -1.9, -2.4, -2.9].map((xPos, i) => (
        <RealisticTurbineStage
          key={`lpt-${i}`}
          position={[xPos, 0, 0]}
          rotation={[0, 0, 0]}
          numBlades={32}
          discRadius={1.0 + i * 0.15}
          bladeHeight={0.8 + i * 0.1}
          bladeWidth={0.3 + i * 0.02}
          color="#a78bfa" 
          speed={4} 
          isPlaying={isPlaying} 
          alert={getStatus('LPT')}
          twistDirection={-1}
        />
      ))}

      {/* Exhaust Cone */}
      <mesh position={[-3.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.7, 1.8, 32]} />
        <meshStandardMaterial color="#451a03" metalness={0.7} roughness={0.7} />
      </mesh>

      {/* Central Shaft (Core) */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 8.5, 12]} />
        <meshStandardMaterial color="#111" metalness={1} roughness={0.2} />
      </mesh>

      {/* Outer Casing Wireframe Guide */}
      <mesh position={[0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[1.7, 1.5, 6.5, 32, 1, true]} />
        <meshBasicMaterial color="#64748b" transparent opacity={0.1} wireframe />
      </mesh>
    </group>
  );
};

// --- UI Components ---
const StatusCard = ({ label, value, subtext, status = 'normal', icon: Icon }) => {
  const colors = {
    normal: 'bg-slate-800/50 border-slate-600 text-sky-400',
    warning: 'bg-yellow-900/30 border-yellow-600 text-yellow-400',
    danger: 'bg-red-900/30 border-red-600 text-red-500 animate-pulse-slow',
  };

  return (
    <div className={`relative border-2 rounded-lg p-4 ${colors[status]}`}>
      <div className="text-xs font-medium opacity-70 mb-1">{label}</div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      {subtext && <div className="text-xs opacity-60">{subtext}</div>}
      {Icon && <Icon className="absolute top-3 right-3 w-5 h-5 opacity-30" />}
    </div>
  );
};

const MaintenanceLog = ({ logs }) => {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="bg-slate-900/80 rounded-lg p-4 h-full border border-slate-700 flex flex-col">
      <div className="flex items-center gap-2 mb-3 text-sky-400 shrink-0">
        <Activity className="w-5 h-5" />
        <span className="font-bold text-sm">실시간 정비 통제 로그</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 text-xs font-mono pr-2 custom-scrollbar">
        {logs.length === 0 && <div className="text-slate-500">시스템 초기화 완료. 데이터 수신 대기 중...</div>}
        {logs.map((log, idx) => (
          <div key={idx} className="text-slate-300 leading-relaxed border-b border-slate-800/50 pb-1 mb-1 last:border-0">
            <span className="text-slate-500 mr-2">[{log.time}]</span>
            <span className={log.type === 'danger' ? 'text-red-400 font-bold' : log.type === 'warning' ? 'text-yellow-400' : 'text-slate-300'}>
              {log.message}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
};

// --- Main App ---
export default function App() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [logs, setLogs] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let interval;
    if (isPlaying && currentStep < SIMULATION_DATA.length - 1) {
      interval = setInterval(() => {
        setCurrentStep(prev => {
          const next = prev + 1;
          processStep(next);
          return next;
        });
      }, 100); 
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentStep]);

  const processStep = (stepIdx) => {
    const data = SIMULATION_DATA[stepIdx];
    setHistory(prev => {
      const newHistory = [...prev, data];
      if (newHistory.length > 50) return newHistory.slice(newHistory.length - 50);
      return newHistory;
    });

    const timestamp = new Date().toLocaleTimeString('ko-KR');

    if (data.rul < DANGER_THRESHOLD && SIMULATION_DATA[stepIdx - 1]?.rul >= DANGER_THRESHOLD) {
      const faultComp = data.components.find(c => c.alert);
      const consolidatedMsg = faultComp 
        ? `🚨 [긴급] RUL 경고 및 ${faultComp.name} 결함 감지! 즉시 점검 요망.`
        : `🚨 [긴급] 잔여 수명(RUL)이 위험 수준(${DANGER_THRESHOLD} 미만)에 도달했습니다.`;
        
      addLog('danger', timestamp, consolidatedMsg);

    } else if (data.rul < 20 && SIMULATION_DATA[stepIdx - 1]?.rul >= 20) {
      addLog('warning', timestamp, `⚠️ [주의] 잔여 수명이 20 사이클 미만입니다. 예방 정비 계획을 수립하세요.`);
    } else if (stepIdx % 50 === 0 && stepIdx !== 0) {
      addLog('normal', timestamp, `시스템 상태 점검: 센서 데이터 수신 양호. Cycle ${data.cycle} 완료.`);
    }
  };

  const addLog = (type, time, message) => {
    setLogs(prev => [...prev, { type, time, message }]);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentStep(0);
    setHistory([SIMULATION_DATA[0]]);
    setLogs([{
      type: 'normal',
      time: new Date().toLocaleTimeString('ko-KR'),
      message: '시스템 준비 완료. 시뮬레이션이 초기화되었습니다.'
    }]);
  };

  const currentData = SIMULATION_DATA[currentStep];
  const isDanger = currentData.rul < DANGER_THRESHOLD;
  const isWarning = currentData.rul < 20 && !isDanger;

  let statusText = '정상 운항 중 (NORMAL)';
  let statusColor = 'text-sky-400';
  let statusBorder = 'border-sky-500';

  if (isDanger) {
    statusText = '긴급 정비 필요 (CRITICAL)';
    statusColor = 'text-red-500';
    statusBorder = 'border-red-600 bg-red-900/10';
  } else if (isWarning) {
    statusText = '점검 요망 (WARNING)';
    statusColor = 'text-yellow-400';
    statusBorder = 'border-yellow-500 bg-yellow-900/10';
  }

  return (
    <div className="w-full h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 p-4 overflow-hidden flex flex-col font-sans">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <Plane className="w-8 h-8 text-sky-400" />
          <div>
            <h1 className="text-2xl font-bold text-sky-400 tracking-tight">HNKUK AIR TechOps</h1>
            <p className="text-xs text-slate-400">항공기 엔진 예지 정비 시스템 (Unit-008)</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`flex items-center gap-2 px-6 py-2 rounded-full font-bold transition shadow-lg ${
              isPlaying
                ? 'bg-yellow-500 hover:bg-yellow-600 text-slate-900'
                : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-500/20'
            }`}
          >
            {isPlaying ? (
              <> <Pause className="w-4 h-4" /> 일시정지 </>
            ) : (
              <> <Play className="w-4 h-4" /> 모니터링 시작 </>
            )}
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-full transition border border-slate-600"
          >
            <RefreshCw className="w-4 h-4" /> 초기화
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        
        {/* Left Panel: Status */}
        <div className="col-span-3 flex flex-col gap-4 min-h-0">
          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700 shrink-0">
            <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
              <Server className="w-4 h-4" /> 엔진 종합 상태
            </h3>
            <div className={`border-2 ${statusBorder} rounded-lg p-4 mb-3 flex items-center justify-center gap-3 transition-colors duration-300`}>
              {isDanger ? (
                <AlertTriangle className="w-6 h-6 text-red-500 animate-pulse" />
              ) : isWarning ? (
                <AlertTriangle className="w-6 h-6 text-yellow-400" />
              ) : (
                <CheckCircle className="w-6 h-6 text-sky-400" />
              )}
              <span className={`text-lg font-bold ${statusColor}`}>{statusText}</span>
            </div>
            <div className="space-y-2">
              <StatusCard label="현재 사이클" value={currentData.cycle} subtext={`/ ${TOTAL_CYCLES}`} status="normal" icon={Activity} />
              <StatusCard
                label="잔여 수명 (RUL)"
                value={`${currentData.rul} Cycles`}
                status={isDanger ? 'danger' : isWarning ? 'warning' : 'normal'}
                icon={Wind}
              />
            </div>
          </div>
          <MaintenanceLog logs={logs} />
        </div>

        {/* Center Panel: 3D Visualization */}
        <div className="col-span-6 bg-slate-900/50 rounded-lg border border-slate-700 overflow-hidden relative flex flex-col">
          <div className="absolute top-4 left-4 z-10 bg-slate-950/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-slate-700">
            <h3 className="text-sm font-bold text-sky-400 flex items-center gap-2">
              <Cpu className="w-4 h-4" /> 3D Digital Twin
            </h3>
            <p className="text-xs text-slate-400 mt-1">Real-time Blade & Shaft Monitoring</p>
          </div>

          <Canvas shadows dpr={[1, 2]}>
            <PerspectiveCamera makeDefault position={[5, 3, 6]} fov={40} />
            <ambientLight intensity={0.4} />
            <directionalLight position={[10, 10, 5]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
            <spotLight position={[5, 0, 5]} angle={0.5} intensity={1} color="#e0f2fe" />
            <pointLight position={[-4, 0, 0]} intensity={1} color="#fb7185" distance={5} /> {/* Exhaust glow */}

            <Suspense fallback={null}>
              <TurbofanEngine3D components={currentData.components} isPlaying={isPlaying} />
            </Suspense>

            <ContactShadows position={[0, -2, 0]} opacity={0.5} scale={20} blur={2} far={4} color="#000" />
            <Environment preset="city" />
            <OrbitControls 
              enablePan={true} 
              enableZoom={true} 
              enableRotate={true} 
              minPolarAngle={0} 
              maxPolarAngle={Math.PI}
              target={[0, 0, 0]}
            />
          </Canvas>

          <div className="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-slate-700 text-xs z-10">
            <div className="flex items-center gap-3">
               <div className="font-bold text-slate-400 mr-2">Airflow:</div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-sky-200"></div>
                <span>Cold Intake</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                <span>Hot Exhaust</span>
              </div>
            </div>
          </div>
          
          <div className="absolute bottom-4 right-4 bg-slate-950/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-slate-700 text-xs flex items-center gap-2 text-slate-400 z-10">
            <MousePointer2 className="w-3 h-3" />
            <span>Drag to Rotate / Scroll to Zoom</span>
          </div>
        </div>

        {/* Right Panel: Analytics */}
        <div className="col-span-3 flex flex-col gap-4 min-h-0">
          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700 flex-1 min-h-0 flex flex-col">
            <h3 className="text-sm font-bold text-slate-300 mb-3 shrink-0">📊 RUL 예측 추세</h3>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="cycle" stroke="#94a3b8" style={{ fontSize: '10px' }} tickFormatter={(val) => `C${val}`} />
                  <YAxis stroke="#94a3b8" style={{ fontSize: '10px' }} domain={[0, 35]} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }} 
                    itemStyle={{ color: '#38bdf8' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <ReferenceLine y={DANGER_THRESHOLD} stroke="#ef4444" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="rul" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700 flex-1 min-h-0 flex flex-col">
            <h3 className="text-sm font-bold text-slate-300 mb-3 shrink-0">🔧 부품별 부하/마모도</h3>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={currentData.components} layout="vertical" margin={{ left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" style={{ fontSize: '10px' }} hide />
                  <YAxis dataKey="key" type="category" stroke="#94a3b8" style={{ fontSize: '11px', fontWeight: 'bold' }} width={40} />
                  <RechartsTooltip cursor={{fill: '#1e293b'}} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                    {currentData.components.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.alert ? '#ef4444' : index === 0 ? '#38bdf8' : '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}