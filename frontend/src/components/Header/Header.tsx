import Image from "next/image";
import Link from "next/link";

export default function Header() {
  return (
    <section className="mx-auto flex w-fit justify-center rounded-[32px] border border-white/[0.09] bg-white/5 px-12 py-5 shadow-[0_4px_30px_rgba(0,0,0,0.25)] backdrop-blur-[7.4px]">
      <Link href={"/"}>
        <Image
          src={"/images/LogoTMWTP.svg"}
          width={400}
          height={400}
          alt="Tell Me What To Play"
          loading="eager"
        />
      </Link>
    </section>
  );
}
