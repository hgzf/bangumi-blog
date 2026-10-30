import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import {
  Directory,
  Encoding,
  Filesystem
} from "@capacitor/filesystem";

const FolderSync = registerPlugin("FolderSync");

globalThis.PlatformMobileNative = {
  Capacitor,
  CapacitorHttp,
  Directory,
  Encoding,
  Filesystem,
  FolderSync
};
