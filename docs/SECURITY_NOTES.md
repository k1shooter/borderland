# 보안/운영 메모

## 사망 처리(Death Lock)
현재 프로토타입은 다음 기준으로 재입장을 차단합니다.

- 계정 username
- wallet address(선택)
- IP hash
- device fingerprint hash

`IP 차단`은 요청사항에 맞게 기본 활성화했지만, 공유 네트워크(학교/회사/기숙사)에서는 오탐이 생길 수 있습니다.
실서비스 전환 시에는 다음 3단계로 운영하는 편이 더 안전합니다.

1. 계정 + 기기 지문 차단
2. 지갑/서명 차단
3. IP는 보조 시그널로만 사용하거나, 관리자 승인 기반으로 운영

## 블록체인
`contracts/DeathRegistry.sol`은 선택 기능입니다.
중요한 점은 **원시 IP를 체인에 올리지 않는 것**이며, 항상 해시만 기록해야 합니다.

## 안티치트
스페이드 계열 피지컬 게임은 현재 클라이언트 제출형 점수 구조이므로, 실서비스 전에는 아래 보강이 필요합니다.

- 입력 리플레이 로그 검증
- 비정상 프레임/시간 패턴 탐지
- WebRTC 또는 서버 authoritative 검증
- rate limit / replay nonce / integrity signature
