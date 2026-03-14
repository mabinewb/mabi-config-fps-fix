from __future__ import annotations

import os
import pathlib
import re
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from mabiconfig_codec import backup_existing_file, decode_config_bytes, encode_config_bytes
from mabiconfig_version import APP_VERSION

TOOL_NAME = "Mabi FPS Fix Tool"
ICON_FILE_NAME = "mabi_tools.ico"


def apply_window_icon(window: tk.Tk) -> None:
    for candidate in (
        pathlib.Path(__file__).with_name(ICON_FILE_NAME),
        pathlib.Path(sys.executable).with_name(ICON_FILE_NAME),
    ):
        if candidate.exists():
            try:
                window.iconbitmap(str(candidate))
                return
            except Exception:
                pass


def default_setting_dir() -> pathlib.Path:
    appdata = os.environ.get("APPDATA")
    if appdata:
        return pathlib.Path(appdata) / "Mabinogi" / "Setting"
    return pathlib.Path.cwd()


def patch_dummychar_fps_to_minus_one(encoded_bytes: bytes) -> bytes:
    decoded = decode_config_bytes(encoded_bytes)
    xml_text = decoded.xml_bytes.decode("utf-16le")

    pattern = r'DummyCharRenderModeFPS="([^"]+)"'
    match = re.search(pattern, xml_text)
    if not match:
        raise ValueError("DummyCharRenderModeFPS 속성을 찾을 수 없습니다.")
    if match.group(1) == "-1":
        raise ValueError("이미 FPS가 -1 상태입니다. 패치할 필요가 없습니다.")

    patched_text = re.sub(pattern, 'DummyCharRenderModeFPS="-1"', xml_text, count=1)
    return encode_config_bytes(patched_text.encode("utf-16le"))


class App(ttk.Frame):
    def __init__(self, master: tk.Tk) -> None:
        super().__init__(master, padding=12)
        self.master = master
        self.pack(fill="both", expand=True)

        self.last_used_dir = default_setting_dir()
        if not self.last_used_dir.exists():
            self.last_used_dir = pathlib.Path.cwd()

        self.selected_file = tk.StringVar(value="")
        self.output_dir = tk.StringVar(value=str(self.last_used_dir))

        self._build_ui()

    def _build_ui(self) -> None:
        self.master.title(f"{TOOL_NAME} v{APP_VERSION}")
        self.master.geometry("760x420")
        self.master.minsize(700, 360)

        ttk.Label(self, text=TOOL_NAME, font=("맑은 고딕", 16, "bold")).pack(anchor="w")
        ttk.Label(
            self,
            text="option xml 파일을 선택하면 FPS를 -1로 바꾸고 같은 파일명으로 저장합니다. 기존 파일은 .bak로 백업합니다.",
            foreground="#555",
        ).pack(anchor="w", pady=(0, 12))

        file_frame = ttk.LabelFrame(self, text="입력 파일", padding=10)
        file_frame.pack(fill="x")
        ttk.Entry(file_frame, textvariable=self.selected_file).pack(side="left", fill="x", expand=True)
        ttk.Button(file_frame, text="파일 선택", command=self.choose_file).pack(side="left", padx=(8, 0))

        output_frame = ttk.LabelFrame(self, text="출력 폴더", padding=10)
        output_frame.pack(fill="x", pady=(12, 0))
        ttk.Entry(output_frame, textvariable=self.output_dir).pack(side="left", fill="x", expand=True)
        ttk.Button(output_frame, text="찾아보기", command=self.choose_output_dir).pack(side="left", padx=(8, 0))

        action_frame = ttk.Frame(self, padding=(0, 12, 0, 0))
        action_frame.pack(fill="x")
        ttk.Button(action_frame, text="변환 실행", command=self.run).pack(side="left")
        ttk.Button(action_frame, text="출력 폴더 열기", command=self.open_output_dir).pack(side="left", padx=(8, 0))

        log_frame = ttk.LabelFrame(self, text="작업 로그", padding=10)
        log_frame.pack(fill="both", expand=True, pady=(12, 0))
        self.log = tk.Text(log_frame, height=12, wrap="word")
        self.log.pack(fill="both", expand=True)
        self.log.configure(state="disabled")

    def write_log(self, message: str) -> None:
        self.log.configure(state="normal")
        self.log.insert(tk.END, message + "\n")
        self.log.see(tk.END)
        self.log.configure(state="disabled")

    def choose_file(self) -> None:
        path = filedialog.askopenfilename(
            title="option xml 파일 선택",
            initialdir=str(self.last_used_dir),
            filetypes=[("XML files", "*.xml"), ("All files", "*.*")],
        )
        if not path:
            return
        self.selected_file.set(path)
        self.last_used_dir = pathlib.Path(path).parent

    def choose_output_dir(self) -> None:
        path = filedialog.askdirectory(title="출력 폴더 선택", initialdir=str(self.last_used_dir))
        if not path:
            return
        self.output_dir.set(path)
        self.last_used_dir = pathlib.Path(path)

    def open_output_dir(self) -> None:
        output_dir = pathlib.Path(self.output_dir.get())
        output_dir.mkdir(parents=True, exist_ok=True)
        os.startfile(output_dir)  # type: ignore[attr-defined]
        self.write_log(f"출력 폴더 열기: {output_dir}")

    def run(self) -> None:
        selected = self.selected_file.get().strip()
        if not selected:
            messagebox.showwarning("파일 없음", "먼저 option xml 파일을 선택하세요.")
            return

        input_path = pathlib.Path(selected)
        if not input_path.exists():
            messagebox.showerror("파일 없음", "선택한 파일이 존재하지 않습니다.")
            return

        output_dir = pathlib.Path(self.output_dir.get())
        output_dir.mkdir(parents=True, exist_ok=True)

        output_path = output_dir / input_path.name

        try:
            encoded_bytes = patch_dummychar_fps_to_minus_one(input_path.read_bytes())
            backup_path = backup_existing_file(output_path)
            output_path.write_bytes(encoded_bytes)
        except Exception as exc:
            self.write_log(f"실패: {input_path.name} -> {exc}")
            messagebox.showerror("변환 실패", str(exc))
            return

        self.write_log(f"성공: {input_path.name} -> {output_path.name}")
        if backup_path is not None:
            self.write_log(f"기존 파일 백업: {backup_path.name}")
        self.write_log("FPS를 -1로 설정했습니다.")
        messagebox.showinfo("완료", f"변환 완료: {output_path.name}")


def main() -> None:
    root = tk.Tk()
    apply_window_icon(root)
    app = App(root)
    app.mainloop()


if __name__ == "__main__":
    main()