// document_start + MAIN world content_script entry. 페이지 자체 스크립트보다 먼저 실행되어
// fetch/XHR/console.* wrap을 페이지 첫 요청 이전에 걸어둔다. 사이드패널이 sentinel을 보낼 때까지 buffering은 비활성.
import "./network-recorder";
import "./console-recorder";
