# 시스템 가이드

## 권장 스택

- 백엔드: Node.js + Express + Socket.IO
- 프런트엔드: 정적 HTML/CSS/Vanilla JS + Canvas/Web Audio
- 실시간: Socket.IO room broadcast
- 저장소: JSON 파일 기반 시드/프로토타입 저장 (추후 PostgreSQL/Redis로 교체 가능)
- 선택 기능: Solidity DeathRegistry 컨트랙트

## 핵심 서브시스템

1. Auth / Death Registry
   - username/password 로그인
   - deviceId(localStorage) + IP hash + user-agent hash 기반 죽음 차단
   - optional wallet address와 chain tx hash 기록

2. Lobby / Room
   - 방 생성, 입장, 준비, 시작
   - 카드 코드별 최소/최대 인원 검증
   - 어드민 전용 bot filler 지원

3. Real-time Game Session
   - 카드별 엔진 생성
   - phase, timer, chat policy, submissions, result log 관리
   - per-player private state 분리

4. Leaderboard
   - 카드 수집 개수 우선
   - 총 생존 횟수, 최근 생존 시각 보조 정렬

5. Admin
   - 모든 카드 테스트
   - 사망 상태 무시하고 재입장 가능
   - 방 상태 강제 초기화 가능